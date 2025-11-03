"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
// electron/main.ts
const electron_1 = require("electron");
const node_path_1 = tslib_1.__importDefault(require("node:path"));
const db_1 = require("./db");
const time_1 = require("./time");
// Handle Squirrel.Windows install/update events early so shortcuts get created.
// electron-squirrel-startup returns true if we are running a Squirrel event (install, update, uninstall)
try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    if (require('electron-squirrel-startup')) {
        electron_1.app.quit();
    }
}
catch { /* ignore if module missing in dev */ }
let win = null;
const pending = new Set(); // slot keys 'YYYY-MM-DDTHH:MM'
let tickerHandle = null; // current scheduled tick timeout
function createWindow() {
    win = new electron_1.BrowserWindow({
        width: 1380,
        height: 860,
        show: false,
        frame: false, // frameless so we can draw custom title bar + window controls
        titleBarStyle: 'hidden', // hide native title bar (macOS shows traffic lights inset if frame true)
        title: 'JF LoggR',
        backgroundColor: '#1e293b', // slight dark bg during load (adjust to theme)
        webPreferences: {
            preload: node_path_1.default.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });
    // Update to new branded AppUserModelID (must match package.json build.appId for notifications & taskbar grouping)
    electron_1.app.setAppUserModelId('com.jyskefinans.jfloggr');
    const devUrl = process.env['VITE_DEV_SERVER_URL'];
    if (devUrl) {
        win.loadURL(devUrl);
        win.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        win.loadFile(node_path_1.default.join(__dirname, '../../dist/work-logger/browser/index.html'));
    }
    win.on('ready-to-show', () => win?.show());
    // Forward maximize state changes to renderer so custom controls reflect current state
    win.on('maximize', () => win?.webContents.send('window:maximize-state', { maximized: true }));
    win.on('unmaximize', () => win?.webContents.send('window:maximize-state', { maximized: false }));
    win.on('enter-full-screen', () => win?.webContents.send('window:maximize-state', { maximized: true }));
    win.on('leave-full-screen', () => win?.webContents.send('window:maximize-state', { maximized: win?.isMaximized() ?? false }));
}
function notifyForSlot(slot) {
    const day = (0, time_1.toLocalDateYMD)(slot);
    const hh = `${slot.getHours()}`.padStart(2, '0');
    const mm = `${slot.getMinutes()}`.padStart(2, '0');
    const slotLen = (0, time_1.getSlotMinutes)();
    const body = `Log ${day} ${hh}:${mm}–${hh}:${(Number(mm) + slotLen).toString().padStart(2, '0')}`;
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
            win?.webContents.send('prompt:open', { slot: (0, time_1.slotKey)(slot) });
        }
        else {
            console.warn('[main] notification clicked but window is null');
        }
    });
    n.show();
}
function scheduleTicker() {
    if (tickerHandle) {
        try {
            clearTimeout(tickerHandle);
        }
        catch { }
        tickerHandle = null;
    }
    const tick = () => {
        const boundary = new Date();
        if ((0, time_1.isWorkTime)(boundary)) {
            const gran = (0, time_1.getSlotMinutes)();
            const currentStart = (0, time_1.currentSlotStart)(boundary);
            try {
                console.log('[main] tick boundary', { boundary: boundary.toISOString(), gran, currentStart: (0, time_1.slotKey)(currentStart) });
            }
            catch { }
            const sDyn = (0, db_1.getSettings)();
            const { h: dsh, m: dsm } = (0, time_1.parseHM)(sDyn.work_start);
            const { h: deh, m: dem } = (0, time_1.parseHM)(sDyn.work_end);
            const dayStart = new Date(boundary);
            dayStart.setHours(dsh, dsm, 0, 0);
            const dayEnd = new Date(boundary);
            dayEnd.setHours(deh, dem, 0, 0);
            // At slot boundary we now prompt for the CURRENT slot (start just begun) instead of the one that finished.
            if (currentStart >= dayStart && currentStart < dayEnd) {
                const key = (0, time_1.slotKey)(currentStart);
                pending.add(key);
                try {
                    console.log('[main] enqueue currentStart', key, 'pending size', pending.size);
                }
                catch { }
                notifyForSlot(currentStart);
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
                    console.log('[main] auto-focus tick -> prompt:open (current slot)', key);
                    win?.webContents.send('prompt:open', { slot: key });
                }
            }
        }
        tickerHandle = setTimeout(tick, (0, time_1.nextQuarter)(new Date()).getTime() - Date.now());
    };
    tickerHandle = setTimeout(tick, (0, time_1.nextQuarter)(new Date()).getTime() - Date.now());
}
function restartTickerIfWorkdayNow() {
    const now = new Date();
    if ((0, time_1.isWorkdayEnabled)(now))
        scheduleTicker();
}
function rebuildBacklogForToday({ includeFuture = false } = {}) {
    // Build backlog only for past (and optionally current) unlogged slots.
    const now = new Date();
    const day = (0, time_1.toLocalDateYMD)(now);
    const done = new Set((0, db_1.getDayEntries)(day).map((e) => `${e.day}T${e.start}`));
    pending.clear();
    const slots = (0, time_1.daySlots)(now); // already filtered by workday
    if (!slots.length) {
        // Non-workday: notify renderer of empty queue
        win?.webContents.send('queue:updated');
        return;
    }
    for (const slot of slots) {
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
    const slots = (0, time_1.daySlots)(now);
    if (!slots.length) {
        win?.webContents.send('queue:updated');
        return;
    }
    for (const slot of slots) {
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
    const before = (0, db_1.getSettings)();
    (0, db_1.saveSettings)(s);
    const after = (0, db_1.getSettings)();
    // Recalculate backlog for already elapsed slots only; future slots will be added by the ticker.
    rebuildPendingAfterSettingsChange({ includeFuture: false });
    // If today was previously disabled and is now enabled, restart ticker + optional catch-up notification
    const now = new Date();
    const wasEnabled = (before.weekdays_mask & (1 << now.getDay())) !== 0;
    const isEnabled = (after.weekdays_mask & (1 << now.getDay())) !== 0;
    if (!wasEnabled && isEnabled && (0, time_1.isWorkTime)(now)) {
        // Emit catch-up for the current slot (we switched to logging at start of interval)
        const currentStart = (0, time_1.currentSlotStart)(now);
        const key = (0, time_1.slotKey)(currentStart);
        if (!pending.has(key)) {
            pending.add(key);
            notifyForSlot(currentStart);
            win?.webContents.send('prompt:open', { slot: key });
            win?.webContents.send('queue:updated');
        }
    }
    restartTickerIfWorkdayNow();
    return { ok: true, settings: after };
});
// Delete single entry and (re)queue slot if it's in the past, allowing user to relog it
electron_1.ipcMain.handle('db:delete-entry', (_e, day, start) => {
    const removed = (0, db_1.deleteEntry)(day, start);
    try {
        // If the slot is in the past (earlier than now), add back to pending so user can re-log
        const [y, m, d] = day.split('-').map(Number);
        const [hh, mm] = start.split(':').map(Number);
        const slotDate = new Date(y, (m || 1) - 1, d, hh, mm, 0, 0);
        const now = new Date();
        const isToday = day === (0, time_1.toLocalDateYMD)(now);
        const shouldRequeue = isToday && slotDate.getTime() < now.getTime() && (0, time_1.isWorkdayEnabled)(slotDate);
        if (shouldRequeue) {
            pending.add(`${day}T${start}`);
            win?.webContents.send('queue:updated');
        }
    }
    catch { /* ignore parse errors */ }
    return { ok: true, removed };
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
// Window control handlers (invoked from renderer via preload contextBridge)
electron_1.ipcMain.handle('window:minimize', () => { win?.minimize(); return { ok: true }; });
electron_1.ipcMain.handle('window:toggle-maximize', () => {
    if (!win)
        return { ok: false, maximized: false };
    if (win.isMaximized())
        win.unmaximize();
    else
        win.maximize();
    return { ok: true, maximized: win.isMaximized() };
});
electron_1.ipcMain.handle('window:close', () => { win?.close(); return { ok: true }; });
electron_1.app.whenReady().then(() => {
    console.log('[main] app is ready, initializing DB and window...');
    (0, db_1.initDb)();
    console.log('[main] creating main window...');
    createWindow();
    // Remove default application menu (we provide custom controls in renderer)
    try {
        electron_1.Menu.setApplicationMenu(null);
    }
    catch { }
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