"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
// electron/main.ts
const electron_1 = require("electron");
const node_path_1 = tslib_1.__importDefault(require("node:path"));
const db_1 = require("./db");
const time_1 = require("./time");
let win = null;
const pending = new Set(); // slot keys 'YYYY-MM-DDTHH:MM'
function createWindow() {
    win = new electron_1.BrowserWindow({
        width: 1100,
        height: 720,
        show: false,
        webPreferences: {
            // IMPORTANT: when compiled, __dirname points to electron/.dist
            // and preload.ts compiles to preload.js in the same folder.
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    // Required for Windows native notifications to group by app
    electron_1.app.setAppUserModelId('com.jyskefinans.worklogger');
    const devUrl = process.env['VITE_DEV_SERVER_URL'];
    if (devUrl) {
        // Dev: Angular dev server
        win.loadURL(devUrl);
        win.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        // Prod: load the built Angular index.html
        // Note: this path is relative to electron/.dist (compiled output)
        win.loadFile(node_path_1.default.join(__dirname, '../../dist/work-logger/browser/index.html'));
    }
    win.on('ready-to-show', () => win?.show());
}
function notifyForSlot(slot) {
    const day = (0, time_1.toLocalDateYMD)(slot);
    const hh = `${slot.getHours()}`.padStart(2, '0');
    const mm = `${slot.getMinutes()}`.padStart(2, '0');
    const slotLen = (0, time_1.getSlotMinutes)();
    const body = `Log ${day} ${hh}:${mm}–${hh}:${(Number(mm) + slotLen)
        .toString()
        .padStart(2, '0')}`;
    const n = new electron_1.Notification({ title: 'Work Logger', body, silent: true });
    n.on('click', () => {
        win?.show();
        win?.focus();
        win?.webContents.send('prompt:open', { slot: (0, time_1.slotKey)(slot) });
    });
    n.show();
}
function scheduleTicker() {
    const now = new Date();
    let next = (0, time_1.nextQuarter)(now);
    // Align to working hours: if before 08:00, jump to 08:00; after 16:00, jump to next day 08:00
    const start = new Date(now);
    start.setHours(8, 0, 0, 0);
    const end = new Date(now);
    end.setHours(16, 0, 0, 0);
    if (now < start)
        next = start;
    if (now >= end) {
        // move to next workday 08:00
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(8, 0, 0, 0);
        next = tomorrow;
    }
    const tick = () => {
        const when = new Date();
        if ((0, time_1.isWorkTime)(when)) {
            const slot = (0, time_1.currentSlotStart)(when);
            const key = (0, time_1.slotKey)(slot);
            pending.add(key); // stack
            notifyForSlot(slot);
        }
        // schedule next quarter
        const n = (0, time_1.nextQuarter)(new Date());
        setTimeout(tick, n.getTime() - Date.now());
    };
    setTimeout(tick, next.getTime() - Date.now());
}
function rebuildBacklogForToday() {
    // At app start, populate pending with any missing slots from today
    const today = new Date();
    // If it's outside work time at startup, we can still build backlog for today safely.
    const day = (0, time_1.toLocalDateYMD)(today);
    const slots = (0, time_1.daySlots)(today).map((s) => (0, time_1.slotKey)(s));
    const done = new Set((0, db_1.getDayEntries)(day).map((e) => `${e.day}T${e.start}`));
    pending.clear();
    slots.forEach((k) => {
        if (!done.has(k))
            pending.add(k);
    });
}
// IPC handlers
console.log('[main] registering IPC handlers...');
electron_1.ipcMain.handle('db:get-day', (_e, day) => (0, db_1.getDayEntries)(day));
electron_1.ipcMain.handle('db:get-days', () => (0, db_1.getDays)());
electron_1.ipcMain.handle('db:save-entries', (_e, entries) => (0, db_1.saveEntries)(entries));
electron_1.ipcMain.handle('db:get-summary', (_e, day) => (0, db_1.getSummary)(day));
electron_1.ipcMain.handle('db:get-recent', (_e, limit) => (0, db_1.getDistinctRecent)(limit ?? 20));
// Settings handlers (missing previously)
electron_1.ipcMain.handle('db:get-settings', () => { const s = (0, db_1.getSettings)(); return s; });
electron_1.ipcMain.handle('db:save-settings', (_e, s) => { (0, db_1.saveSettings)(s); return { ok: true, settings: (0, db_1.getSettings)() }; });
electron_1.ipcMain.handle('queue:get', () => Array.from(pending).sort());
electron_1.ipcMain.handle('queue:submit', (_e, payload) => {
    const groupedByDay = new Map();
    payload.slots.forEach((k) => {
        const [day, hm] = k.split('T');
        const [h, m] = hm.split(':');
        const slotLen = (0, time_1.getSlotMinutes)();
        const endMin = (Number(m) + slotLen) % 60;
        const endHour = endMin === 0 ? Number(h) + 1 : Number(h);
        const entry = {
            day,
            start: `${h}:${m}`,
            end: `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`,
            description: payload.description.trim(),
            category: payload.category.trim()
        };
        if (!groupedByDay.has(day))
            groupedByDay.set(day, []);
        groupedByDay.get(day).push(entry);
        pending.delete(k);
    });
    groupedByDay.forEach((list) => (0, db_1.saveEntries)(list));
    return { ok: true };
});
// Debug notification trigger (manual test without waiting for scheduler)
electron_1.ipcMain.handle('debug:notify', (_e, opts) => {
    const body = opts?.body ?? 'Test notification';
    const slot = new Date();
    const n = new electron_1.Notification({ title: 'Work Logger (Test)', body, silent: true });
    n.on('click', () => {
        win?.show();
        win?.focus();
        win?.webContents.send('prompt:open', { slot: (0, time_1.slotKey)(slot) });
    });
    n.show();
    return { ok: true };
});
electron_1.app.whenReady().then(() => {
    console.log('[main] app is ready, initializing DB and window...');
    (0, db_1.initDb)();
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
    electron_1.app.on('activate', () => {
        console.log('[main] app activate event');
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
//# sourceMappingURL=main.js.map