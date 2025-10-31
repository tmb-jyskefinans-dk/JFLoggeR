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
  getSettings,
  saveSettings
} from './db';

import {
  nextQuarter,
  currentSlotStart,
  isWorkTime,
  slotKey,
  daySlots,
  toLocalDateYMD,
  getSlotMinutes
} from './time';

let win: BrowserWindow | null = null;
const pending: Set<string> = new Set(); // slot keys 'YYYY-MM-DDTHH:MM'

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    webPreferences: {
      // IMPORTANT: when compiled, __dirname points to electron/.dist
      // and preload.ts compiles to preload.js in the same folder.
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // Required for Windows native notifications to group by app
  app.setAppUserModelId('com.jyskefinans.worklogger');

  const devUrl = process.env['VITE_DEV_SERVER_URL'];
  if (devUrl) {
    // Dev: Angular dev server
    win.loadURL(devUrl);
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Prod: load the built Angular index.html
    // Note: this path is relative to electron/.dist (compiled output)
    win.loadFile(path.join(__dirname, '../../dist/work-logger/browser/index.html'));
  }

  win.on('ready-to-show', () => win?.show());
}

function notifyForSlot(slot: Date) {
  const day = toLocalDateYMD(slot);
  const hh = `${slot.getHours()}`.padStart(2, '0');
  const mm = `${slot.getMinutes()}`.padStart(2, '0');
  const slotLen = getSlotMinutes();
  const body = `Log ${day} ${hh}:${mm}–${hh}:${(Number(mm) + slotLen)
    .toString()
    .padStart(2, '0')}`;

  const n = new Notification({ title: 'Work Logger', body, silent: true });
  n.on('click', () => {
    win?.show();
    win?.focus();
    win?.webContents.send('prompt:open', { slot: slotKey(slot) });
  });
  n.show();
}

function scheduleTicker() {
  const now = new Date();
  let next = nextQuarter(now);

  // Align to working hours: if before 08:00, jump to 08:00; after 16:00, jump to next day 08:00
  const start = new Date(now);
  start.setHours(8, 0, 0, 0);
  const end = new Date(now);
  end.setHours(16, 0, 0, 0);

  if (now < start) next = start;
  if (now >= end) {
    // move to next workday 08:00
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(8, 0, 0, 0);
    next = tomorrow;
  }

  const tick = () => {
    const when = new Date();
    if (isWorkTime(when)) {
      const slot = currentSlotStart(when);
      const key = slotKey(slot);
      pending.add(key); // stack
      notifyForSlot(slot);
    }
    // schedule next quarter
    const n = nextQuarter(new Date());
    setTimeout(tick, n.getTime() - Date.now());
  };

  setTimeout(tick, next.getTime() - Date.now());
}

function rebuildBacklogForToday() {
  // At app start, populate pending with any missing slots from today
  const today = new Date();
  // If it's outside work time at startup, we can still build backlog for today safely.
  const day = toLocalDateYMD(today);
  const slots = daySlots(today).map((s) => slotKey(s));
  const done = new Set(
    getDayEntries(day).map((e: any) => `${e.day}T${e.start}`)
  );
  pending.clear();
  slots.forEach((k) => {
    if (!done.has(k)) pending.add(k);
  });
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
// Settings handlers (missing previously)
ipcMain.handle('db:get-settings', () => { const s = getSettings(); return s; });
ipcMain.handle('db:save-settings', (_e, s) => { saveSettings(s); return { ok: true, settings: getSettings() }; });


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
  const n = new Notification({ title: 'Work Logger (Test)', body, silent: true });
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
  rebuildBacklogForToday();
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
