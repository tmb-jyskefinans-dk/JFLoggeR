// electron/main.ts
import { app, BrowserWindow, ipcMain, Notification, Menu, Tray, nativeImage, powerMonitor } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import https from 'node:https';

// Lightweight structured logging to file + console. Rotates by day (new file per day).
function ensureLogDir(): string {
  const dir = path.join(app.getPath('userData'), 'logs');
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  return dir;
}
function currentLogFile(): string {
  const day = new Date().toISOString().slice(0,10);
  return path.join(ensureLogDir(), `app-${day}.log`);
}
function writeLog(level: string, message: string, meta?: any) {
  try {
    const ts = new Date().toISOString();
    const line = JSON.stringify({ ts, level, message, meta: meta ?? null });
    // Console echo (condensed)
    const prefix = `[${level}]`;
    if (level === 'error') console.error(prefix, message, meta ?? '');
    else if (level === 'warn') console.warn(prefix, message, meta ?? '');
    else console.log(prefix, message, meta ?? '');
    fs.appendFile(currentLogFile(), line + '\n', () => {/* ignore errors */});
  } catch (e) { /* last-chance; avoid throwing in logger */ }
}

const CORPORATE_JIRA_ORIGIN = 'https://app-jira.corp.jyskebank.net';
const corporateJiraAgent = new https.Agent({ rejectUnauthorized: false });

function fetchCorporateJiraJson(url: string, headers: Record<string, string>) {
  return new Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      headers,
      agent: corporateJiraAgent
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 500;
        resolve({
          status,
          ok: status >= 200 && status < 300,
          json: async () => bodyText ? JSON.parse(bodyText) : {}
        });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

let fatalShutdownInProgress = false;

function handleFatalProcessError(kind: 'uncaughtException' | 'unhandledRejection', error: unknown) {
  const err = error as { message?: string; stack?: string };
  writeLog(kind, err?.message || String(error), {
    stack: err?.stack,
    reason: kind === 'unhandledRejection' ? error : undefined
  });

  // Prevent duplicate shutdown attempts when multiple fatal errors arrive.
  if (fatalShutdownInProgress) return;
  fatalShutdownInProgress = true;

  try { win?.webContents.send('app:fatal-error', { kind, message: err?.message || String(error) }); } catch { }

  if (!app.isPackaged) {
    // Keep development sessions alive for faster debugging after logging the failure.
    fatalShutdownInProgress = false;
    return;
  }

  setTimeout(() => {
    try { app.exit(1); } catch { }
  }, 1500);

  try { app.quit(); } catch { }
}

// Capture process-level failures early
process.on('uncaughtException', (err) => {
  handleFatalProcessError('uncaughtException', err);
});
process.on('unhandledRejection', (reason: unknown) => {
  handleFatalProcessError('unhandledRejection', reason);
});

import {
  initDb,
  getDayEntries,
  saveEntries,
  getSummary,
  getDays,
  getDistinctRecent,
  getDistinctRecentToday,
  getSettings,
  saveSettings,
  deleteEntry,
  importExternalLines
} from './db';
import { computeStaleSlot } from './stale';
import { setExternalLogged, getExternalLogged } from './db';
import { azureAuth } from './auth';

import {
  nextQuarter,
  previousSlotStart,
  isWorkTime,
  isWorkdayEnabled,
  slotKey,
  daySlots,
  toLocalDateYMD,
  getSlotMinutes,
  parseHM
} from './time';
import { JiraApiIssue, mapAndRankJiraIssues } from './jira-search';

// Handle Squirrel.Windows install/update events early so shortcuts get created.
// electron-squirrel-startup returns true if we are running a Squirrel event (install, update, uninstall)
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  if (require('electron-squirrel-startup')) {
    app.quit();
  }
} catch { /* ignore if module missing in dev */ }

// Auto-update (GitHub releases). Only initialize when the app is packaged.
// In dev (ts outDir .dist) update-electron-app tries to read a package.json next to main.js (electron/.dist/package.json)
// which does not exist, causing ENOENT. Guard with app.isPackaged.
try {
  if (app.isPackaged) {
    // Initialize simplified auto-update helper (GitHub releases).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('update-electron-app')({
      // updateInterval: '1 hour', // uncomment to poll periodically
    });
    // Hook into underlying electron-updater events to notify user.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { autoUpdater } = require('electron-updater');
    autoUpdater.on('checking-for-update', () => console.log('[update] checking for update...'));
    autoUpdater.on('update-available', (info: any) => {
      console.log('[update] update available', info?.version);

      try {
        const n = new Notification({
          title: 'Ny opdatering klar',
          body: `Version ${info?.version} er tilgængelig.`,
          silent: !!getSettings().notification_silent
        });
        n.show();
        // Also inform renderer in case it wants to surface a UI prompt.
        win?.webContents.send('update:ready', { version: info?.version });
      } catch (notifyErr) { console.warn('[update] update available notify failed', notifyErr); }


    });
    autoUpdater.on('update-not-available', () => console.log('[update] no update available'));
    autoUpdater.on('error', (err: any) => console.warn('[update] error', err));
    autoUpdater.on('download-progress', (p: any) => {
      try { console.log('[update] download progress', Math.round(p.percent) + '%'); } catch { }
    });
    autoUpdater.on('update-downloaded', (info: any) => {
      console.log('[update] downloaded', info?.version);
      try {
        const n = new Notification({
          title: 'Opdatering klar',
          body: `Version ${info?.version} er klar. Genstart for at installere nu.`,
          silent: !!getSettings().notification_silent
        });
        n.on('click', () => {
          try { autoUpdater.quitAndInstall(); } catch { }
        });
        n.show();
        // Also inform renderer in case it wants to surface a UI prompt.
        win?.webContents.send('update:ready', { version: info?.version });
      } catch (notifyErr) { console.warn('[update] notify failed', notifyErr); }
    });
  } else {
    console.log('[main] skipping auto-update init (development environment)');
  }
} catch (e) {
  console.warn('[main] auto-update init failed', e);
}

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
const pending: Set<string> = new Set(); // slot keys 'YYYY-MM-DDTHH:MM'
let tickerHandle: NodeJS.Timeout | null = null; // current scheduled tick timeout
let staleCheckHandle: NodeJS.Timeout | null = null;
let lastStaleNotifiedKey: string | null = null;
let digestQueue: Date[] = []; // slots accumulated while user away
let lastEntryEndTime: Date | null = null; // for stale detection heuristics
let jiraMyselfCache: { psaKey: string; accountId?: string; displayName?: string; emailAddress?: string } | null = null;

type JiraMyselfResponse = {
  accountId?: unknown;
  key?: unknown;
  name?: unknown;
  displayName?: unknown;
  emailAddress?: unknown;
};

type JiraResolvedIdentity = {
  accountId?: string;
  displayName?: string;
  emailAddress?: string;
};

async function resolveJiraIdentity(psaKey: string): Promise<JiraResolvedIdentity | undefined> {
  if (!psaKey) return undefined;
  if (jiraMyselfCache && jiraMyselfCache.psaKey === psaKey) {
    return {
      accountId: jiraMyselfCache.accountId,
      displayName: jiraMyselfCache.displayName,
      emailAddress: jiraMyselfCache.emailAddress
    };
  }

  try {
    const url = `${CORPORATE_JIRA_ORIGIN}/jira/rest/api/2/myself`;
    const res = await fetchCorporateJiraJson(url, {
      Accept: 'application/json',
      Authorization: `Bearer ${psaKey}`
    });
    if (!res.ok) {
      jiraMyselfCache = { psaKey };
      return undefined;
    }

    const data = await res.json() as JiraMyselfResponse;
    const accountId = String(data.accountId ?? data.key ?? data.name ?? '').trim() || undefined;
    const displayName = String(data.displayName ?? '').trim() || undefined;
    const emailAddress = String(data.emailAddress ?? '').trim() || undefined;
    jiraMyselfCache = { psaKey, accountId, displayName, emailAddress };
    return { accountId, displayName, emailAddress };
  } catch {
    jiraMyselfCache = { psaKey };
    return undefined;
  }
}

async function resolveJiraAccountId(psaKey: string): Promise<string | undefined> {
  const identity = await resolveJiraIdentity(psaKey);
  return identity?.accountId;
}

// Centralized helper to add a slot key to the pending set and notify renderer.
// Optionally suppress immediate event for bulk operations (caller emits once afterwards).
function enqueuePending(key: string, opts: { silent?: boolean } = {}) {
  if (!key) return;
  if (!pending.has(key)) pending.add(key);
  if (!opts.silent) {
    try { win?.webContents.send('queue:updated'); } catch { }
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 860,
    show: false,
    frame: false, // frameless so we can draw custom title bar + window controls
    titleBarStyle: 'hidden', // hide native title bar (macOS shows traffic lights inset if frame true)
    title: 'JF LoggR',
    backgroundColor: '#1e293b', // slight dark bg during load (adjust to theme)
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Ensure timers (notifications ticker, stale checks) continue firing with accurate cadence
      // even when window is unfocused or minimized. This prevents delayed queue updates.
      backgroundThrottling: false
    }
  });

  // Update to new branded AppUserModelID (must match package.json build.appId for notifications & taskbar grouping)
  app.setAppUserModelId('com.jyskefinans.jfloggr');

  const devUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../../dist/work-logger/browser/index.html'));
  }

  win.on('ready-to-show', () => win?.show());

  // Forward maximize state changes to renderer so custom controls reflect current state
  win.on('maximize', () => win?.webContents.send('window:maximize-state', { maximized: true }));
  win.on('unmaximize', () => win?.webContents.send('window:maximize-state', { maximized: false }));
  win.on('enter-full-screen', () => win?.webContents.send('window:maximize-state', { maximized: true }));
  win.on('leave-full-screen', () => win?.webContents.send('window:maximize-state', { maximized: win?.isMaximized() ?? false }));
}

function updateTrayTooltip() {
  try {
    if (!tray) return;
    const today = toLocalDateYMD(new Date());
    const summary = getSummary(today) as any[];
    const top = summary.slice(0, 3).map(s => `${s.category}: ${s.minutes}m`).join(' | ');
    const total = summary.reduce((a, s) => a + s.minutes, 0);
    tray.setToolTip(top ? `${today} • ${top} • Total: ${total}m` : `${today} • Ingen registreringer endnu`);
  } catch (e) { console.error('[main] updateTrayTooltip failed', e); }
}

function showDigestNotification() {
  if (!digestQueue.length) return;
  // Capture the earliest & latest slot BEFORE we clear the queue so the notification click handler
  // can reference a stable value. Previously we referenced digestQueue[0] inside the click handler
  // after digestQueue was cleared, causing slotKey(undefined) -> TypeError.
  const firstSlot = digestQueue[0];
  const lastSlot = digestQueue[digestQueue.length - 1];
  if (!firstSlot || !lastSlot) { digestQueue = []; return; }
  const body = `${digestQueue.length} uloggede intervaller fra ${firstSlot.getHours().toString().padStart(2, '0')}:${firstSlot.getMinutes().toString().padStart(2, '0')} til ${lastSlot.getHours().toString().padStart(2, '0')}:${lastSlot.getMinutes().toString().padStart(2, '0')}`;
  const st = getSettings();
  const n = new Notification({ title: 'Opsummering af uloggede intervaller', body, silent: !!st.notification_silent });
  n.on('click', () => {
    if (win) {
      try { if (win.isMinimized()) win.restore(); } catch { }
      try { win.show(); win.focus(); } catch { }
      // Open prompt for earliest slot captured at notification creation time.
      win?.webContents.send('prompt:open', { slot: slotKey(firstSlot), source: 'notification' });
      // Force open dialog even if slot was previously handled so user can re-log or review.
      win?.webContents.send('dialog:open-log', { slot: slotKey(firstSlot), source: 'notification' });
    }
  });
  n.show();
  digestQueue = [];
}

function notifyForSlot(slot: Date) {
  const day = toLocalDateYMD(slot);
  const hh = `${slot.getHours()}`.padStart(2, '0');
  const mm = `${slot.getMinutes()}`.padStart(2, '0');
  const slotLen = getSlotMinutes();
  const body = `Log ${day} ${hh}:${mm}–${hh}:${(Number(mm) + slotLen).toString().padStart(2, '0')}`;

  const st = getSettings();
  const n = new Notification({ title: 'Tid til at registér tid', body, silent: !!st.notification_silent });
  n.on('click', () => {
    if (win) {
      try { if (win.isMinimized()) win.restore(); } catch { }
      try { win.show(); } catch { }
      try { win.focus(); } catch { }
      try { win!.setAlwaysOnTop(true); win!.focus(); setTimeout(() => { try { win!.setAlwaysOnTop(false); } catch { } }, 400); } catch { }
      console.log('[main] notification click -> prompt:open', slotKey(slot));
      win?.webContents.send('prompt:open', { slot: slotKey(slot), source: 'notification' });
      // Also force dialog open regardless of prior handled state.
      win?.webContents.send('dialog:open-log', { slot: slotKey(slot), source: 'notification' });
    } else {
      console.warn('[main] notification clicked but window is null');
    }
  });
  // Group notifications when user away & grouping enabled
  try {
    const away = !win?.isFocused() || powerMonitor.getSystemIdleTime() > (getSlotMinutes() * 60);
    if (away && st.group_notifications) {
      digestQueue.push(slot);
      // If many accumulated, send digest now
      if (digestQueue.length >= 4) {
        showDigestNotification();
      }
    } else {
      n.show();
    }
  } catch { n.show(); }
}

function scheduleTicker() {
  if (tickerHandle) { try { clearTimeout(tickerHandle); } catch { } tickerHandle = null; }
  const tick = () => {
    const boundary = new Date(); // This is the start of the NEW slot
    if (isWorkTime(boundary)) {
      const gran = getSlotMinutes();
      const prevStart = previousSlotStart(boundary); // Slot that just finished
      try { console.log('[main] tick boundary', { boundary: boundary.toISOString(), gran, prevStart: slotKey(prevStart) }); } catch { }
      const sDyn = getSettings();
      const { h: dsh, m: dsm } = parseHM(sDyn.work_start);
      const { h: deh, m: dem } = parseHM(sDyn.work_end);
      const dayStart = new Date(boundary); dayStart.setHours(dsh, dsm, 0, 0);
      const dayEnd = new Date(boundary); dayEnd.setHours(deh, dem, 0, 0);
      // Prompt for the slot that FINISHED (prevStart) if it lies fully within work hours.
      if (prevStart >= dayStart && prevStart < dayEnd) {
        const key = slotKey(prevStart);
        // Guard against re-queueing already logged slot
        const day = toLocalDateYMD(prevStart);
        const alreadyLogged = isSlotCoveredByEntries(prevStart, getDayEntries(day) as Array<{ start: string; end: string }>);
        if (!alreadyLogged) {
          enqueuePending(key); // emits queue:updated
          try { console.log('[main] enqueue prevStart', key, 'pending size', pending.size); } catch { }
          notifyForSlot(prevStart);
          if (sDyn.auto_focus_on_slot && win) {
            try { if (win.isMinimized()) win.restore(); } catch { }
            try { win.show(); } catch { }
            try { win.focus(); } catch { }
            try { win!.setAlwaysOnTop(true); win!.focus(); setTimeout(() => { try { win!.setAlwaysOnTop(false); } catch { } }, 350); } catch { }
            console.log('[main] auto-focus tick -> prompt:open (previous slot just finished)', key);
            win?.webContents.send('prompt:open', { slot: key, source: 'auto-focus' });
          }
        }
      }
    }
    tickerHandle = setTimeout(tick, nextQuarter(new Date()).getTime() - Date.now());
  };
  tickerHandle = setTimeout(tick, nextQuarter(new Date()).getTime() - Date.now());
}

function restartTickerIfWorkdayNow() {
  const now = new Date();
  if (isWorkdayEnabled(now)) scheduleTicker();
}

function scheduleStaleCheck() {
  if (staleCheckHandle) { try { clearInterval(staleCheckHandle); } catch { } }
  staleCheckHandle = setInterval(() => {
    try {
      const st = getSettings();
      const result = computeStaleSlot(Array.from(pending), new Date(), st, getSlotMinutes());
      if (result && result.key !== lastStaleNotifiedKey) {
        lastStaleNotifiedKey = result.key;
        const hm = result.key.split('T')[1];
        const body = `Interval fra ${hm} er nu over ${Math.round(result.ageMinutes)} min uden registrering. Log tiden for at undgå at glemme den.`;
        const n = new Notification({ title: 'Overvokset interval', body, silent: !!st.notification_silent });
        n.on('click', () => {
          if (win) {
            try { win.show(); win.focus(); } catch { }
            win?.webContents.send('prompt:open', { slot: result.key, source: 'notification' });
            win?.webContents.send('dialog:open-log', { slot: result.key, source: 'notification' });
          }
        });
        n.show();
      }
    } catch {/* ignore */ }
  }, 60000);
}

function hmToMinutes(hm: string): number {
  const { h, m } = parseHM(String(hm ?? '00:00'));
  return h * 60 + m;
}

/** Returns true when slot start is already covered by an existing logged interval on that day. */
function isSlotCoveredByEntries(slotStart: Date, entries: Array<{ start: string; end: string }>): boolean {
  const slotStartMinutes = slotStart.getHours() * 60 + slotStart.getMinutes();
  for (const e of entries) {
    const startM = hmToMinutes(e.start);
    const endM = hmToMinutes(e.end);
    if (!Number.isFinite(startM) || !Number.isFinite(endM) || endM <= startM) continue;
    if (slotStartMinutes >= startM && slotStartMinutes < endM) return true;
  }
  return false;
}

function rebuildBacklogForToday({ includeFuture = false }: { includeFuture?: boolean } = {}) {
  // Build backlog only for finished unlogged slots.
  const now = new Date();
  const day = toLocalDateYMD(now);
  const dayEntries = getDayEntries(day) as Array<{ start: string; end: string }>;
  pending.clear();
  const slots = daySlots(now); // already filtered by workday
  if (!slots.length) {
    // Non-workday: notify renderer of empty queue
    win?.webContents.send('queue:updated');
    return;
  }
  for (const slot of slots) {
    // Only add to pending if the slot's END time is in the past
    const slotEnd = new Date(slot.getTime() + getSlotMinutes() * 60000);
    if (!includeFuture && slotEnd.getTime() > now.getTime()) break; // stop at first slot that hasn't ended
    const key = slotKey(slot);
    if (!isSlotCoveredByEntries(slot, dayEntries)) enqueuePending(key, { silent: true });
  }
  // Single emit after bulk rebuild
  try { win?.webContents.send('queue:updated'); } catch { }
}

// Rebuild pending queue when settings change. By default only future (>= now) slots are queued
// to avoid flooding the user with historical prompts after a granularity change.
function rebuildPendingAfterSettingsChange({ includeFuture = false }: { includeFuture?: boolean } = {}) {
  const now = new Date();
  const day = toLocalDateYMD(now);
  const dayEntries = getDayEntries(day) as Array<{ start: string; end: string }>;
  pending.clear();
  const slots = daySlots(now);
  if (!slots.length) {
    win?.webContents.send('queue:updated');
    return;
  }
  for (const slot of slots) {
    // Only add to pending if the slot's END time is in the past
    const slotEnd = new Date(slot.getTime() + getSlotMinutes() * 60000);
    const key = slotKey(slot);
    if (isSlotCoveredByEntries(slot, dayEntries)) continue; // already logged by an interval covering this slot
    if (!includeFuture && slotEnd.getTime() > now.getTime()) break; // stop at first slot that hasn't ended
    enqueuePending(key, { silent: true });
  }
  try { win?.webContents.send('queue:updated'); } catch { }
}

function logIpcFailure(channel: string, err: unknown) {
  const error = err as { message?: string; stack?: string };
  writeLog('error', `IPC handler failed: ${channel}`, {
    message: error?.message ?? String(err),
    stack: error?.stack
  });
}

// IPC handlers
console.log('[main] registering IPC handlers...');
ipcMain.handle('db:get-day', (_e, day: string) => {
  try {
    return getDayEntries(day);
  } catch (e) {
    logIpcFailure('db:get-day', e);
    throw e;
  }
});
ipcMain.handle('db:get-days', () => {
  try {
    return getDays();
  } catch (e) {
    logIpcFailure('db:get-days', e);
    throw e;
  }
});
ipcMain.handle('db:get-external-logged', (_e, day: string) => ({ day, exported: getExternalLogged(day) }));
ipcMain.handle('db:set-external-logged', (_e, day: string, exported: boolean) => setExternalLogged(day, exported));
ipcMain.handle('db:save-entries', (_e, entries: any[]) => {
  try {
    return saveEntries(entries);
  } catch (e) {
    logIpcFailure('db:save-entries', e);
    throw e;
  }
});
ipcMain.handle('db:import-external', (_e, raw: string) => {
  try {
    const result = importExternalLines(String(raw ?? ''));
    // After import refresh pending/backlog since newly added slots should not remain pending.
    rebuildBacklogForToday({ includeFuture: false });
    return { ok: true, ...result };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
});
ipcMain.handle('db:get-summary', (_e, day: string) => {
  try {
    return getSummary(day);
  } catch (e) {
    logIpcFailure('db:get-summary', e);
    throw e;
  }
});
ipcMain.handle('db:get-recent', (_e, limit?: number) =>
  getDistinctRecent(limit ?? 20)
);
ipcMain.handle('db:get-recent-today', (_e, limit?: number) =>
  getDistinctRecentToday(limit ?? 20)
);
// Settings handlers (missing previously)
ipcMain.handle('db:get-settings', () => { const s = getSettings(); return s; });
ipcMain.handle('db:save-settings', (_e, s) => {
  const before = getSettings();
  saveSettings(s);
  const after = getSettings();
  // Recalculate backlog for already elapsed slots only; future slots will be added by the ticker.
  rebuildPendingAfterSettingsChange({ includeFuture: false });
  // If today was previously disabled and is now enabled, restart ticker + optional catch-up notification
  const now = new Date();
  const wasEnabled = (before.weekdays_mask & (1 << now.getDay())) !== 0;
  const isEnabled = (after.weekdays_mask & (1 << now.getDay())) !== 0;
  // When enabling mid-workday we now WAIT until next boundary (end of current slot) instead of immediate catch-up.
  restartTickerIfWorkdayNow();
  // Apply auto-start setting (Windows/macOS)
  try { app.setLoginItemSettings({ openAtLogin: !!after.auto_start_on_login }); } catch { }
  return { ok: true, settings: after };
});

ipcMain.handle('auth:get-status', () => azureAuth.getStatus());
ipcMain.handle('auth:signin', async () => {
  const result = await azureAuth.signInInteractive();
  if (!result.ok) {
    writeLog('warn', 'Azure sign-in failed', { error: result.error });
  }
  return result;
});
ipcMain.handle('auth:signout', async () => {
  const result = await azureAuth.signOut();
  writeLog('info', 'Azure sign-out completed');
  return result;
});

ipcMain.handle('jira:search-issues', async (_e, payload: { term?: string }) => {
  try {
    const term = String(payload?.term ?? '').trim();
    if (term.length < 2) return { ok: true, items: [] };

    const settings = getSettings();
    const psaKey = String(settings.jira_psa_key ?? '').trim();
    const projectKey = String(settings.jira_project_key ?? '').trim().toUpperCase();
    if (!psaKey || !projectKey) {
      return { ok: false, error: 'Jira PSA key eller project key mangler i indstillinger.' };
    }
    const escapedTerm = term.replace(/"/g, '\\"');
    const keyCandidate = term.toUpperCase().replace(/"/g, '\\"');
    const clauses = [`summary ~ "${escapedTerm}*"`];
    if (/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(term)) {
      clauses.unshift(`key = "${keyCandidate}"`);
    }
    const query = encodeURIComponent(
      `project = ${projectKey} AND (${clauses.join(' OR ')}) ORDER BY created DESC`
    );

    const url = `${CORPORATE_JIRA_ORIGIN}/jira/rest/api/2/search?jql=${query}&fields=key,summary,issuetype,assignee,reporter,customfield_10060&maxResults=10`;
    const res = await fetchCorporateJiraJson(url, {
      Accept: 'application/json',
      Authorization: `Bearer ${psaKey}`
    });

    if (!res.ok) {
      return { ok: false, error: `Jira opslag fejlede (${res.status}).` };
    }

    const data = await res.json() as { issues?: JiraApiIssue[] };
    const currentAccountId = await resolveJiraAccountId(psaKey);
    const items = mapAndRankJiraIssues(data.issues ?? [], term, currentAccountId);

    return { ok: true, items };
  } catch (e) {
    console.log('Jira search failed', e);
    logIpcFailure('jira:search-issues', e);
    return { ok: false, error: 'Jira opslag fejlede.' };
  }
});

ipcMain.handle('jira:verify-identity', async (_e, payload?: { psaKey?: string }) => {
  try {
    const settings = getSettings();
    const psaKey = String(payload?.psaKey ?? settings.jira_psa_key ?? '').trim();
    if (!psaKey) {
      return { ok: false, error: 'Jira PSA key mangler i indstillinger.' };
    }

    const identity = await resolveJiraIdentity(psaKey);
    if (!identity?.accountId) {
      return { ok: false, error: 'PSA key kunne ikke verificeres mod Jira /myself.' };
    }

    return {
      ok: true,
      accountId: identity.accountId,
      displayName: identity.displayName,
      emailAddress: identity.emailAddress
    };
  } catch (e) {
    logIpcFailure('jira:verify-identity', e);
    return { ok: false, error: 'Jira verifikation fejlede.' };
  }
});

// Categories in 'Udvikling Projekter' group that support Jira worklog posting
const JIRA_WORKLOG_CATEGORIES = new Set([
  'Udvikling (prioriterede jf. projektoversigten)',
  'Estimering'
]);

function postCorporateJiraJson(url: string, headers: Record<string, string>, body: unknown) {
  return new Promise<{ status: number; ok: boolean; json: () => Promise<unknown> }>((resolve, reject) => {
    const bodyStr = JSON.stringify(body);
    const req = https.request(url, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(bodyStr) },
      agent: corporateJiraAgent
    }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        const status = res.statusCode ?? 500;
        resolve({ status, ok: status >= 200 && status < 300, json: async () => bodyText ? JSON.parse(bodyText) : {} });
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

ipcMain.handle('jira:log-worklog', async (_e, payload: { day: string }) => {
  try {
    const day = String(payload?.day ?? '').trim();
    if (!day) return { ok: false, error: 'Dag mangler.' };

    const settings = getSettings();
    const psaKey = String(settings.jira_psa_key ?? '').trim();
    if (!psaKey) return { ok: false, error: 'Jira PSA key mangler i indstillinger.' };

    const entries = getDayEntries(day).filter((e: any) => JIRA_WORKLOG_CATEGORIES.has(e.category));
    if (!entries.length) return { ok: true, results: [] };

    // Aggregate seconds + earliest start per Jira key
    const aggr = new Map<string, { seconds: number; earliest: string }>();
    for (const entry of entries as Array<{ day: string; start: string; end: string; description: string; category: string }>) {
      const m = entry.description?.match(/^([A-Z]+-\d+)\s*-\s*/);
      if (!m) continue;
      const key = m[1];
      const [sh, sm] = entry.start.split(':').map(Number);
      const [eh, em] = entry.end.split(':').map(Number);
      const seconds = ((eh * 60 + em) - (sh * 60 + sm)) * 60;
      if (seconds <= 0) continue;
      const existing = aggr.get(key);
      if (existing) {
        existing.seconds += seconds;
        if (entry.start < existing.earliest) existing.earliest = entry.start;
      } else {
        aggr.set(key, { seconds, earliest: entry.start });
      }
    }

    if (!aggr.size) return { ok: true, results: [] };

    const [y, mo, d] = day.split('-').map(Number);
    const authHeaders = { Accept: 'application/json', Authorization: `Bearer ${psaKey}` };
    const results: Array<{ key: string; seconds: number; success: boolean; error?: string }> = [];

    for (const [key, { seconds, earliest }] of aggr) {
      try {
        const [hh, mm] = earliest.split(':').map(Number);
        const started = new Date(y, (mo || 1) - 1, d || 1, hh, mm, 0, 0);
        const pad2 = (n: number) => String(n).padStart(2, '0');
        const tz = -started.getTimezoneOffset();
        const tzSign = tz >= 0 ? '+' : '-';
        const tzH = pad2(Math.floor(Math.abs(tz) / 60));
        const tzM = pad2(Math.abs(tz) % 60);
        const startedStr = `${day}T${pad2(hh)}:${pad2(mm)}:00.000${tzSign}${tzH}${tzM}`;
        const url = `${CORPORATE_JIRA_ORIGIN}/jira/rest/api/2/issue/${key}/worklog`;
        const res = await postCorporateJiraJson(url, authHeaders, {
          timeSpentSeconds: seconds,
          started: startedStr,
          comment: 'Logged via JFLoggeR'
        });
        if (res.ok) {
          results.push({ key, seconds, success: true });
        } else {
          results.push({ key, seconds, success: false, error: `HTTP ${res.status}` });
        }
      } catch (e) {
        results.push({ key, seconds, success: false, error: String(e) });
      }
    }

    const allOk = results.every(r => r.success);
    return { ok: allOk, results };
  } catch (e) {
    logIpcFailure('jira:log-worklog', e);
    return { ok: false, error: 'Jira worklog fejlede.' };
  }
});

// Delete single entry and (re)queue slot if it's in the past, allowing user to relog it
ipcMain.handle('db:delete-entry', (_e, day: string, start: string) => {
  try {
    const removed = deleteEntry(day, start);
    try {
      // If the slot is in the past (earlier than now), add back to pending so user can re-log
      const [y, m, d] = day.split('-').map(Number);
      const [hh, mm] = start.split(':').map(Number);
      const slotDate = new Date(y, (m || 1) - 1, d, hh, mm, 0, 0);
      const now = new Date();
      const isToday = day === toLocalDateYMD(now);
      const shouldRequeue = isToday && slotDate.getTime() < now.getTime() && isWorkdayEnabled(slotDate);
      if (shouldRequeue) enqueuePending(`${day}T${start}`); // emits queue:updated
    } catch { /* ignore parse errors */ }
    return { ok: true, removed };
  } catch (e) {
    logIpcFailure('db:delete-entry', e);
    return { ok: false, removed: 0, error: String(e) };
  }
});

// Generic renderer -> main log sink
ipcMain.handle('log:write', (_e, entry: { level: string; message: string; meta?: any }) => {
  try { writeLog(entry.level || 'info', entry.message || '', entry.meta); return { ok: true }; } catch (e) { return { ok: false, error: String(e) }; }
});


ipcMain.handle('queue:get', () => {
  return Array.from(pending).sort();
});
ipcMain.handle(
  'queue:submit',
  (
    _e,
    payload: { slots: string[]; description: string; category: string; minimizeWindowAfterSubmit?: boolean }
  ) => {
    try {
      if (!payload || !Array.isArray(payload.slots)) return { ok: false, error: 'Invalid payload' };
      const description = String(payload.description ?? '').trim();
      const category = String(payload.category ?? '').trim();
      if (!description || !category) return { ok: false, error: 'Description and category are required' };

      const groupedByDay = new Map<string, any[]>();
      const coverageByDay = new Map<string, Array<{ start: string; end: string }>>();
      const consumedKeys: string[] = [];
      for (const k of payload.slots) {
        if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(k)) {
          return { ok: false, error: `Invalid slot key: ${String(k)}` };
        }
        const [day, hm] = k.split('T');
        const [h, m] = hm.split(':');
        const hh = Number(h);
        const mm = Number(m);
        if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
          return { ok: false, error: `Invalid slot time: ${k}` };
        }
        if (!coverageByDay.has(day)) {
          coverageByDay.set(day, (getDayEntries(day) as Array<{ start: string; end: string }>).map(e => ({ start: e.start, end: e.end })));
        }
        const [y, mo, d] = day.split('-').map(Number);
        const slotStart = new Date(y, (mo || 1) - 1, d || 1, hh, mm, 0, 0);
        const dayCoverage = coverageByDay.get(day)!;
        if (isSlotCoveredByEntries(slotStart, dayCoverage)) {
          consumedKeys.push(k);
          continue;
        }
        const slotLen = getSlotMinutes();
        const endTotal = hh * 60 + mm + slotLen;
        const endMin = endTotal % 60;
        const endHour = Math.floor(endTotal / 60) % 24;
        const entry = {
          day,
          start: `${h}:${m}`,
          end: `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(
            2,
            '0'
          )}`,
          description,
          category
        };
        if (!groupedByDay.has(day)) groupedByDay.set(day, []);
        groupedByDay.get(day)!.push(entry);
        dayCoverage.push({ start: entry.start, end: entry.end });
        consumedKeys.push(k);
      }
      groupedByDay.forEach((list) => saveEntries(list));
      for (const key of consumedKeys) {
        if (pending.has(key)) pending.delete(key);
      }
    } catch (e) {
      logIpcFailure('queue:submit', e);
      return { ok: false, error: String(e) };
    }
    // Notify renderer that pending slots were consumed so its badge clears quickly (optimistic before loadPending).
    try { win?.webContents.send('queue:updated'); } catch { }
    // Update lastEntryEndTime for today
    try {
      const today = toLocalDateYMD(new Date());
      const todayEntries = getDayEntries(today);
      if (todayEntries.length) {
        const last = todayEntries[todayEntries.length - 1];
        if (last?.end) {
          const [hh, mm] = last.end.split(':').map(Number);
          const [y, mo, d] = today.split('-').map(Number);
          lastEntryEndTime = new Date(y, (mo || 1) - 1, d || 1, hh, mm, 0, 0);
        }
      }
    } catch { }
    updateTrayTooltip();
    if (payload?.minimizeWindowAfterSubmit) {
      try { win?.minimize(); } catch { }
    }
    return { ok: true };
  }
);

// Debug notification trigger (manual test without waiting for scheduler)
ipcMain.handle('debug:notify', (_e, opts?: { body?: string }) => {
  const body = opts?.body ?? 'Test notification';
  const slot = new Date();
  const st = getSettings();
  const n = new Notification({ title: 'Work Logger (Test)', body, silent: !!st.notification_silent });
  n.on('click', () => {
    win?.show();
    win?.focus();
    win?.webContents.send('prompt:open', { slot: slotKey(slot), source: 'notification' });
    win?.webContents.send('dialog:open-log', { slot: slotKey(slot), source: 'notification' });
  });
  n.show();
  return { ok: true };
});

// Window control handlers (invoked from renderer via preload contextBridge)
ipcMain.handle('window:minimize', () => { win?.minimize(); return { ok: true }; });
ipcMain.handle('window:toggle-maximize', () => {
  if (!win) return { ok: false, maximized: false };
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
  return { ok: true, maximized: win.isMaximized() };
});
ipcMain.handle('window:close', () => { win?.close(); return { ok: true }; });

app.whenReady().then(() => {
  console.log('[main] app is ready, initializing DB and window...');
  initDb();
  console.log('[main] creating main window...');
  createWindow();
  // Create tray icon
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    let img: any;
    try { img = nativeImage.createFromPath(iconPath); } catch { }
    tray = new Tray(img && !img.isEmpty() ? img : nativeImage.createEmpty());
    updateTrayTooltip();
    // Provide a context menu so user can interact with the app from the tray
    try {
      const trayMenu = Menu.buildFromTemplate([
        {
          label: 'Vis / Skjul',
          click: () => {
            if (!win) return;
            try {
              if (win.isVisible()) {
                win.hide();
              } else {
                win.show();
                win.focus();
              }
            } catch { }
          }
        },
        {
          label: 'Log nu',
          click: () => {
            if (!win) return;
            try { win.show(); win.focus(); } catch { }
            // Open prompt for the slot that just finished (previous slot) so user can log immediately.
            const prev = previousSlotStart(new Date());
            const key = slotKey(prev);
            // Emit both prompt (for selection logic) and a manual dialog open event that bypasses handledPromptSlot gating.
            win?.webContents.send('prompt:open', { slot: key, source: 'tray' });
            win?.webContents.send('dialog:open-log', { slot: key, source: 'tray' });
          }
        },
        {
          label: 'Log alle ventende',
          click: () => {
            if (!win) return;
            try { win.show(); win.focus(); } catch { }
            // Only open bulk dialog if there are pending slots
            if (pending.size > 0) {
              win?.webContents.send('dialog:open-log-all');
            } else {
              // Optionally could show a notification; for now silently ignore.
              console.log('[main] bulk log requested but no pending slots');
            }
          }
        },
        {
          label: 'Gå til i dag',
          click: () => {
            if (!win) return;
            try { win.show(); win.focus(); } catch { }
            // Send explicit navigate event for today summary view
            const today = toLocalDateYMD(new Date());
            win?.webContents.send('navigate:today', { day: today });
          }
        },
        { type: 'separator' },
        {
          label: 'Afslut',
          click: () => { try { app.quit(); } catch { } }
        }
      ]);
      tray.setContextMenu(trayMenu);
      // Left-click toggles window visibility for quick access
      tray.on('click', () => {
        if (!win) return;
        try {
          if (win.isVisible()) {
            // On Windows a single click often means "show"; keep behavior consistent: always show & focus
            win.focus();
          } else {
            win.show(); win.focus();
          }
        } catch { }
      });
    } catch (menuErr) { console.error('[main] tray menu init failed', menuErr); }
  } catch (e) { console.error('[main] tray init failed', e); }
  // Remove default application menu (we provide custom controls in renderer)
  try { Menu.setApplicationMenu(null); } catch { }
  console.log('[main] rebuilding backlog for today...');
  rebuildBacklogForToday({ includeFuture: false });
  console.log('[main] scheduling ticker for notifications...');
  scheduleTicker();
  scheduleStaleCheck();
  console.log('[main] initialization complete.');

  // Signal to renderer that core initialization (handlers + DB + window) is complete
  win?.webContents.send('app:ready');

  console.log('[main] registering app event handlers...');
  app.on('activate', () => {
    console.log('[main] app activate event');
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on('browser-window-focus', () => {
    // Flush digest queue when user returns
    if (digestQueue.length) {
      showDigestNotification();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Clear timers proactively on quit to avoid lingering handles (housekeeping hardening)
app.on('before-quit', () => {
  try { if (tickerHandle) clearTimeout(tickerHandle); } catch { }
  try { if (staleCheckHandle) clearInterval(staleCheckHandle); } catch { }
  tickerHandle = null; staleCheckHandle = null;
});
