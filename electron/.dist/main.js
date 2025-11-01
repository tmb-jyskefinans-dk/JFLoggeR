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
        width: 1380,
        height: 860,
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
    const st = (0, db_1.getSettings)();
    const n = new electron_1.Notification({ title: 'Tid til at registér tid', body, silent: !!st.notification_silent });
    n.on('click', () => {
        if (win) {
            try {
                if (win.isMinimized())
                    win.restore();
            }
            catch { }
            try {
                win.show();
            }
            catch { }
            try {
                win.focus();
            }
            catch { }
            try {
                win.setAlwaysOnTop(true);
                win.focus();
                setTimeout(() => { try {
                    win.setAlwaysOnTop(false);
                }
                catch { } }, 400);
            }
            catch { }
            console.log('[main] notification click -> prompt:open', (0, time_1.slotKey)(slot));
            win.webContents.send('prompt:open', { slot: (0, time_1.slotKey)(slot) });
        }
        else {
            console.warn('[main] notification clicked but window is null');
        }
    });
    n.show();
}
function scheduleTicker() {
    const now = new Date();
    let next = (0, time_1.nextQuarter)(now);
    // Establish today's working window boundaries from settings
    const s = (0, db_1.getSettings)();
    const { h: sh, m: sm } = (0, time_1.parseHM)(s.work_start);
    const { h: eh, m: em } = (0, time_1.parseHM)(s.work_end);
    const start = new Date(now);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(now);
    end.setHours(eh, em, 0, 0);
    if (now < start) {
        next = start; // first tick at work start
    }
    else if (now >= end) {
        // Move to next workday start (skipping disabled days)
        let tomorrow = new Date(now);
        do {
            tomorrow.setDate(tomorrow.getDate() + 1);
        } while (!(0, time_1.isWorkTime)(new Date(tomorrow.getFullYear(), tomorrow.getMonth(), tomorrow.getDate(), sh, sm)) && !isFinite(sh));
        tomorrow.setHours(sh, sm, 0, 0);
        next = tomorrow;
    }
    const tick = () => {
        const boundary = new Date(); // slot boundary (start of new slot)
        if ((0, time_1.isWorkTime)(boundary)) {
            const gran = (0, time_1.getSlotMinutes)();
            const currentStart = (0, time_1.currentSlotStart)(boundary); // start of slot that just began
            const prevStart = new Date(currentStart.getTime() - gran * 60000); // slot that just finished
            // Debug: log both previous and current slot boundaries to verify we are enqueueing the START of the finished slot
            try {
                console.log('[main] tick boundary', {
                    boundary: boundary.toISOString(),
                    gran,
                    currentStart: (0, time_1.slotKey)(currentStart),
                    prevStart: (0, time_1.slotKey)(prevStart)
                });
            }
            catch { /* ignore logging errors */ }
            // Re-evaluate working window for this boundary (in case settings changed mid-day)
            const sDyn = (0, db_1.getSettings)();
            const { h: dsh, m: dsm } = (0, time_1.parseHM)(sDyn.work_start);
            const { h: deh, m: dem } = (0, time_1.parseHM)(sDyn.work_end);
            const dayStart = new Date(boundary);
            dayStart.setHours(dsh, dsm, 0, 0);
            const dayEnd = new Date(boundary);
            dayEnd.setHours(deh, dem, 0, 0);
            if (prevStart >= dayStart && prevStart < dayEnd) {
                const key = (0, time_1.slotKey)(prevStart);
                pending.add(key);
                try {
                    console.log('[main] enqueue prevStart', key, 'pending size', pending.size);
                }
                catch { }
                notifyForSlot(prevStart);
                if (sDyn.auto_focus_on_slot && win) {
                    try {
                        if (win.isMinimized())
                            win.restore();
                    }
                    catch { }
                    try {
                        win.show();
                    }
                    catch { }
                    try {
                        win.focus();
                    }
                    catch { }
                    try {
                        win.setAlwaysOnTop(true);
                        win.focus();
                        setTimeout(() => { try {
                            win.setAlwaysOnTop(false);
                        }
                        catch { } }, 350);
                    }
                    catch { }
                    console.log('[main] auto-focus tick -> prompt:open', key);
                    win.webContents.send('prompt:open', { slot: key });
                }
            }
        }
        const n = (0, time_1.nextQuarter)(new Date());
        setTimeout(tick, n.getTime() - Date.now());
    };
    setTimeout(tick, next.getTime() - Date.now());
}
function rebuildBacklogForToday({ includeFuture = false } = {}) {
    // Build backlog only for past (and optionally current) unlogged slots.
    const now = new Date();
    const day = (0, time_1.toLocalDateYMD)(now);
    const done = new Set((0, db_1.getDayEntries)(day).map((e) => `${e.day}T${e.start}`));
    pending.clear();
    for (const slot of (0, time_1.daySlots)(now)) {
        if (!includeFuture && slot.getTime() >= now.getTime())
            break; // stop at first future slot
        const key = (0, time_1.slotKey)(slot);
        if (!done.has(key))
            pending.add(key);
    }
}
// Rebuild pending queue when settings change. By default only future (>= now) slots are queued
// to avoid flooding the user with historical prompts after a granularity change.
function rebuildPendingAfterSettingsChange({ includeFuture = false } = {}) {
    const now = new Date();
    const day = (0, time_1.toLocalDateYMD)(now);
    const existing = new Set((0, db_1.getDayEntries)(day).map((e) => `${e.day}T${e.start}`));
    pending.clear();
    for (const slot of (0, time_1.daySlots)(now)) {
        const key = (0, time_1.slotKey)(slot);
        if (existing.has(key))
            continue; // already logged
        if (!includeFuture && slot.getTime() >= now.getTime())
            break; // stop adding at first future slot
        if (!doneOrLogged(key))
            pending.add(key);
    }
    win?.webContents.send('queue:updated');
    function doneOrLogged(key) { return existing.has(key); }
}
// IPC handlers
console.log('[main] registering IPC handlers...');
electron_1.ipcMain.handle('db:get-day', (_e, day) => (0, db_1.getDayEntries)(day));
electron_1.ipcMain.handle('db:get-days', () => (0, db_1.getDays)());
electron_1.ipcMain.handle('db:save-entries', (_e, entries) => (0, db_1.saveEntries)(entries));
electron_1.ipcMain.handle('db:get-summary', (_e, day) => (0, db_1.getSummary)(day));
electron_1.ipcMain.handle('db:get-recent', (_e, limit) => (0, db_1.getDistinctRecent)(limit ?? 20));
electron_1.ipcMain.handle('db:get-recent-today', (_e, limit) => (0, db_1.getDistinctRecentToday)(limit ?? 20));
// Settings handlers (missing previously)
electron_1.ipcMain.handle('db:get-settings', () => { const s = (0, db_1.getSettings)(); return s; });
electron_1.ipcMain.handle('db:save-settings', (_e, s) => {
    (0, db_1.saveSettings)(s);
    // Recalculate backlog for already elapsed slots only; future slots will be added by the ticker.
    rebuildPendingAfterSettingsChange({ includeFuture: false });
    return { ok: true, settings: (0, db_1.getSettings)() };
});
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
    const st = (0, db_1.getSettings)();
    const n = new electron_1.Notification({ title: 'Work Logger (Test)', body, silent: !!st.notification_silent });
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
    rebuildBacklogForToday({ includeFuture: false });
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