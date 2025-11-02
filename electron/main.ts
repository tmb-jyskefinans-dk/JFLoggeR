// electron/main.ts
import { app, BrowserWindow, ipcMain, Notification } from 'electron';
import path from 'node:path';

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
  deleteEntry
} from './db';

import {
  nextQuarter,
  currentSlotStart,
  isWorkTime,
  isWorkdayEnabled,
  slotKey,
  daySlots,
  toLocalDateYMD,
  getSlotMinutes,
  parseHM
} from './time';

let win: BrowserWindow | null = null;
const pending: Set<string> = new Set(); // slot keys 'YYYY-MM-DDTHH:MM'
let tickerHandle: NodeJS.Timeout | null = null; // current scheduled tick timeout

function createWindow() {
  win = new BrowserWindow({
    width: 1380,
    height: 860,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  app.setAppUserModelId('com.jyskefinans.worklogger');

  const devUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devUrl) {
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '../../dist/work-logger/browser/index.html'));
  }

  win.on('ready-to-show', () => win?.show());
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
      try { if (win.isMinimized()) win.restore(); } catch {}
      try { win.show(); } catch {}
      try { win.focus(); } catch {}
      try { win!.setAlwaysOnTop(true); win!.focus(); setTimeout(() => { try { win!.setAlwaysOnTop(false); } catch {} }, 400); } catch {}
      console.log('[main] notification click -> prompt:open', slotKey(slot));
      win?.webContents.send('prompt:open', { slot: slotKey(slot) });
    } else {
      console.warn('[main] notification clicked but window is null');
    }
  });
  n.show();
}

function scheduleTicker() {
  if (tickerHandle) { try { clearTimeout(tickerHandle); } catch {} tickerHandle = null; }
  const tick = () => {
    const boundary = new Date();
    if (isWorkTime(boundary)) {
      const gran = getSlotMinutes();
      const currentStart = currentSlotStart(boundary);
      const prevStart = new Date(currentStart.getTime() - gran * 60000);
      try { console.log('[main] tick boundary', { boundary: boundary.toISOString(), gran, currentStart: slotKey(currentStart), prevStart: slotKey(prevStart) }); } catch {}
      const sDyn = getSettings();
      const { h: dsh, m: dsm } = parseHM(sDyn.work_start);
      const { h: deh, m: dem } = parseHM(sDyn.work_end);
      const dayStart = new Date(boundary); dayStart.setHours(dsh, dsm, 0, 0);
      const dayEnd = new Date(boundary); dayEnd.setHours(deh, dem, 0, 0);
      if (prevStart >= dayStart && prevStart < dayEnd) {
        const key = slotKey(prevStart);
        pending.add(key);
        try { console.log('[main] enqueue prevStart', key, 'pending size', pending.size); } catch {}
        notifyForSlot(prevStart);
        if (sDyn.auto_focus_on_slot && win) {
          try { if (win.isMinimized()) win.restore(); } catch {}
          try { win.show(); } catch {}
          try { win.focus(); } catch {}
          try { win!.setAlwaysOnTop(true); win!.focus(); setTimeout(() => { try { win!.setAlwaysOnTop(false); } catch {} }, 350); } catch {}
          console.log('[main] auto-focus tick -> prompt:open', key);
          win?.webContents.send('prompt:open', { slot: key });
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

function rebuildBacklogForToday({ includeFuture = false }: { includeFuture?: boolean } = {}) {
  // Build backlog only for past (and optionally current) unlogged slots.
  const now = new Date();
  const day = toLocalDateYMD(now);
  const done = new Set(getDayEntries(day).map((e: any) => `${e.day}T${e.start}`));
  pending.clear();
  const slots = daySlots(now); // already filtered by workday
  if (!slots.length) {
    // Non-workday: notify renderer of empty queue
    win?.webContents.send('queue:updated');
    return;
  }
  for (const slot of slots) {
    if (!includeFuture && slot.getTime() >= now.getTime()) break; // stop at first future slot
    const key = slotKey(slot);
    if (!done.has(key)) pending.add(key);
  }
}

// Rebuild pending queue when settings change. By default only future (>= now) slots are queued
// to avoid flooding the user with historical prompts after a granularity change.
function rebuildPendingAfterSettingsChange({ includeFuture = false }: { includeFuture?: boolean } = {}) {
  const now = new Date();
  const day = toLocalDateYMD(now);
  const existing = new Set(getDayEntries(day).map((e: any) => `${e.day}T${e.start}`));
  pending.clear();
  const slots = daySlots(now);
  if (!slots.length) {
    win?.webContents.send('queue:updated');
    return;
  }
  for (const slot of slots) {
    const key = slotKey(slot);
    if (existing.has(key)) continue; // already logged
    if (!includeFuture && slot.getTime() >= now.getTime()) break; // stop adding at first future slot
    if (!doneOrLogged(key)) pending.add(key);
  }
  win?.webContents.send('queue:updated');
  function doneOrLogged(key: string) { return existing.has(key); }
}

// IPC handlers
console.log('[main] registering IPC handlers...');
ipcMain.handle('db:get-day', (_e, day: string) => getDayEntries(day));
ipcMain.handle('db:get-days', () => getDays());
ipcMain.handle('db:save-entries', (_e, entries: any[]) => saveEntries(entries));
ipcMain.handle('db:get-summary', (_e, day: string) => getSummary(day));
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
  if (!wasEnabled && isEnabled && isWorkTime(now)) {
    // Emit catch-up for the previous slot
    const gran = getSlotMinutes();
    const prevStart = new Date(currentSlotStart(now).getTime() - gran * 60000);
    const key = slotKey(prevStart);
    if (!pending.has(key)) {
      pending.add(key);
      notifyForSlot(prevStart);
      win?.webContents.send('prompt:open', { slot: key });
      win?.webContents.send('queue:updated');
    }
  }
  restartTickerIfWorkdayNow();
  return { ok: true, settings: after };
});

// Delete single entry and (re)queue slot if it's in the past, allowing user to relog it
ipcMain.handle('db:delete-entry', (_e, day: string, start: string) => {
  const removed = deleteEntry(day, start);
  try {
    // If the slot is in the past (earlier than now), add back to pending so user can re-log
    const [y, m, d] = day.split('-').map(Number);
    const [hh, mm] = start.split(':').map(Number);
    const slotDate = new Date(y, (m || 1) - 1, d, hh, mm, 0, 0);
    const now = new Date();
    const isToday = day === toLocalDateYMD(now);
    const shouldRequeue = isToday && slotDate.getTime() < now.getTime() && isWorkdayEnabled(slotDate);
    if (shouldRequeue) {
      pending.add(`${day}T${start}`);
      win?.webContents.send('queue:updated');
    }
  } catch { /* ignore parse errors */ }
  return { ok: true, removed };
});


ipcMain.handle('queue:get', () => Array.from(pending).sort());
ipcMain.handle(
  'queue:submit',
  (
    _e,
    payload: { slots: string[]; description: string; category: string }
  ) => {
    const groupedByDay = new Map<string, any[]>();
    payload.slots.forEach((k) => {
      const [day, hm] = k.split('T');
      const [h, m] = hm.split(':');
      const slotLen = getSlotMinutes();
      const endMin = (Number(m) + slotLen) % 60;
      const endHour = endMin === 0 ? Number(h) + 1 : Number(h);
      const entry = {
        day,
        start: `${h}:${m}`,
        end: `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(
          2,
          '0'
        )}`,
        description: payload.description.trim(),
        category: payload.category.trim()
      };
      if (!groupedByDay.has(day)) groupedByDay.set(day, []);
      groupedByDay.get(day)!.push(entry);
      pending.delete(k);
    });
    groupedByDay.forEach((list) => saveEntries(list));
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
    win?.webContents.send('prompt:open', { slot: slotKey(slot) });
  });
  n.show();
  return { ok: true };
});

app.whenReady().then(() => {
  console.log('[main] app is ready, initializing DB and window...');
  initDb();
  console.log('[main] creating main window...');
  createWindow();
  console.log('[main] rebuilding backlog for today...');
  rebuildBacklogForToday({ includeFuture: false });
  console.log('[main] scheduling ticker for notifications...');
  scheduleTicker();
  console.log('[main] initialization complete.');

  // Signal to renderer that core initialization (handlers + DB + window) is complete
  win?.webContents.send('app:ready');

  console.log('[main] registering app event handlers...');
  app.on('activate', () => {
    console.log('[main] app activate event');
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
