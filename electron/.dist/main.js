"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
// electron/main.ts
const electron_1 = require("electron");
const node_path_1 = tslib_1.__importDefault(require("node:path"));
const db_1 = require("./db");
const stale_1 = require("./stale");
const db_2 = require("./db");
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
// Auto-update (GitHub releases). Only initialize when the app is packaged.
// In dev (ts outDir .dist) update-electron-app tries to read a package.json next to main.js (electron/.dist/package.json)
// which does not exist, causing ENOENT. Guard with app.isPackaged.
try {
    if (electron_1.app.isPackaged) {
        // Initialize simplified auto-update helper (GitHub releases).
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('update-electron-app')({
        // updateInterval: '1 hour', // uncomment to poll periodically
        });
        // Hook into underlying electron-updater events to notify user.
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const { autoUpdater } = require('electron-updater');
        autoUpdater.on('checking-for-update', () => console.log('[update] checking for update...'));
        autoUpdater.on('update-available', (info) => {
            console.log('[update] update available', info?.version);
            try {
                const n = new electron_1.Notification({
                    title: 'Ny opdatering klar',
                    body: `Version ${info?.version} er tilgængelig.`,
                    silent: !!(0, db_1.getSettings)().notification_silent
                });
                n.show();
                // Also inform renderer in case it wants to surface a UI prompt.
                win?.webContents.send('update:ready', { version: info?.version });
            }
            catch (notifyErr) {
                console.warn('[update] update available notify failed', notifyErr);
            }
        });
        autoUpdater.on('update-not-available', () => console.log('[update] no update available'));
        autoUpdater.on('error', (err) => console.warn('[update] error', err));
        autoUpdater.on('download-progress', (p) => {
            try {
                console.log('[update] download progress', Math.round(p.percent) + '%');
            }
            catch { }
        });
        autoUpdater.on('update-downloaded', (info) => {
            console.log('[update] downloaded', info?.version);
            try {
                const n = new electron_1.Notification({
                    title: 'Opdatering klar',
                    body: `Version ${info?.version} er klar. Genstart for at installere nu.`,
                    silent: !!(0, db_1.getSettings)().notification_silent
                });
                n.on('click', () => {
                    try {
                        autoUpdater.quitAndInstall();
                    }
                    catch { }
                });
                n.show();
                // Also inform renderer in case it wants to surface a UI prompt.
                win?.webContents.send('update:ready', { version: info?.version });
            }
            catch (notifyErr) {
                console.warn('[update] notify failed', notifyErr);
            }
        });
    }
    else {
        console.log('[main] skipping auto-update init (development environment)');
    }
}
catch (e) {
    console.warn('[main] auto-update init failed', e);
}
let win = null;
let tray = null;
const pending = new Set(); // slot keys 'YYYY-MM-DDTHH:MM'
let tickerHandle = null; // current scheduled tick timeout
let staleCheckHandle = null;
let lastStaleNotifiedKey = null;
let digestQueue = []; // slots accumulated while user away
let lastEntryEndTime = null; // for stale detection heuristics
// Centralized helper to add a slot key to the pending set and notify renderer.
// Optionally suppress immediate event for bulk operations (caller emits once afterwards).
function enqueuePending(key, opts = {}) {
    if (!key)
        return;
    if (!pending.has(key))
        pending.add(key);
    if (!opts.silent) {
        try {
            win?.webContents.send('queue:updated');
        }
        catch { }
    }
}
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
            nodeIntegration: false,
            // Ensure timers (notifications ticker, stale checks) continue firing with accurate cadence
            // even when window is unfocused or minimized. This prevents delayed queue updates.
            backgroundThrottling: false
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
function updateTrayTooltip() {
    try {
        if (!tray)
            return;
        const today = (0, time_1.toLocalDateYMD)(new Date());
        const summary = (0, db_1.getSummary)(today);
        const top = summary.slice(0, 3).map(s => `${s.category}: ${s.minutes}m`).join(' | ');
        const total = summary.reduce((a, s) => a + s.minutes, 0);
        tray.setToolTip(top ? `${today} • ${top} • Total: ${total}m` : `${today} • Ingen registreringer endnu`);
    }
    catch (e) {
        console.error('[main] updateTrayTooltip failed', e);
    }
}
function showDigestNotification() {
    if (!digestQueue.length)
        return;
    // Capture the earliest & latest slot BEFORE we clear the queue so the notification click handler
    // can reference a stable value. Previously we referenced digestQueue[0] inside the click handler
    // after digestQueue was cleared, causing slotKey(undefined) -> TypeError.
    const firstSlot = digestQueue[0];
    const lastSlot = digestQueue[digestQueue.length - 1];
    if (!firstSlot || !lastSlot) {
        digestQueue = [];
        return;
    }
    const body = `${digestQueue.length} uloggede intervaller fra ${firstSlot.getHours().toString().padStart(2, '0')}:${firstSlot.getMinutes().toString().padStart(2, '0')} til ${lastSlot.getHours().toString().padStart(2, '0')}:${lastSlot.getMinutes().toString().padStart(2, '0')}`;
    const st = (0, db_1.getSettings)();
    const n = new electron_1.Notification({ title: 'Opsummering af uloggede intervaller', body, silent: !!st.notification_silent });
    n.on('click', () => {
        if (win) {
            try {
                if (win.isMinimized())
                    win.restore();
            }
            catch { }
            try {
                win.show();
                win.focus();
            }
            catch { }
            // Open prompt for earliest slot captured at notification creation time.
            win?.webContents.send('prompt:open', { slot: (0, time_1.slotKey)(firstSlot) });
            // Force open dialog even if slot was previously handled so user can re-log or review.
            win?.webContents.send('dialog:open-log', { slot: (0, time_1.slotKey)(firstSlot) });
        }
    });
    n.show();
    digestQueue = [];
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
            // Also force dialog open regardless of prior handled state.
            win?.webContents.send('dialog:open-log', { slot: (0, time_1.slotKey)(slot) });
        }
        else {
            console.warn('[main] notification clicked but window is null');
        }
    });
    // Group notifications when user away & grouping enabled
    try {
        const away = !win?.isFocused() || electron_1.powerMonitor.getSystemIdleTime() > ((0, time_1.getSlotMinutes)() * 60);
        if (away && st.group_notifications) {
            digestQueue.push(slot);
            // If many accumulated, send digest now
            if (digestQueue.length >= 4) {
                showDigestNotification();
            }
        }
        else {
            n.show();
        }
    }
    catch {
        n.show();
    }
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
        const boundary = new Date(); // This is the start of the NEW slot
        if ((0, time_1.isWorkTime)(boundary)) {
            const gran = (0, time_1.getSlotMinutes)();
            const prevStart = (0, time_1.previousSlotStart)(boundary); // Slot that just finished
            try {
                console.log('[main] tick boundary', { boundary: boundary.toISOString(), gran, prevStart: (0, time_1.slotKey)(prevStart) });
            }
            catch { }
            const sDyn = (0, db_1.getSettings)();
            const { h: dsh, m: dsm } = (0, time_1.parseHM)(sDyn.work_start);
            const { h: deh, m: dem } = (0, time_1.parseHM)(sDyn.work_end);
            const dayStart = new Date(boundary);
            dayStart.setHours(dsh, dsm, 0, 0);
            const dayEnd = new Date(boundary);
            dayEnd.setHours(deh, dem, 0, 0);
            // Prompt for the slot that FINISHED (prevStart) if it lies fully within work hours.
            if (prevStart >= dayStart && prevStart < dayEnd) {
                const key = (0, time_1.slotKey)(prevStart);
                // Guard against re-queueing already logged slot
                const day = (0, time_1.toLocalDateYMD)(prevStart);
                const hh = `${prevStart.getHours()}`.padStart(2, '0');
                const mm = `${prevStart.getMinutes()}`.padStart(2, '0');
                const alreadyLogged = (0, db_1.getDayEntries)(day).some(e => e.day === day && e.start === `${hh}:${mm}`);
                if (!alreadyLogged) {
                    enqueuePending(key); // emits queue:updated
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
                        console.log('[main] auto-focus tick -> prompt:open (previous slot just finished)', key);
                        win?.webContents.send('prompt:open', { slot: key });
                    }
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
function scheduleStaleCheck() {
    if (staleCheckHandle) {
        try {
            clearInterval(staleCheckHandle);
        }
        catch { }
    }
    staleCheckHandle = setInterval(() => {
        try {
            const st = (0, db_1.getSettings)();
            const result = (0, stale_1.computeStaleSlot)(Array.from(pending), new Date(), st, (0, time_1.getSlotMinutes)());
            if (result && result.key !== lastStaleNotifiedKey) {
                lastStaleNotifiedKey = result.key;
                const hm = result.key.split('T')[1];
                const body = `Interval fra ${hm} er nu over ${Math.round(result.ageMinutes)} min uden registrering. Log tiden for at undgå at glemme den.`;
                const n = new electron_1.Notification({ title: 'Overvokset interval', body, silent: !!st.notification_silent });
                n.on('click', () => {
                    if (win) {
                        try {
                            win.show();
                            win.focus();
                        }
                        catch { }
                        win?.webContents.send('prompt:open', { slot: result.key });
                        win?.webContents.send('dialog:open-log', { slot: result.key });
                    }
                });
                n.show();
            }
        }
        catch { /* ignore */ }
    }, 60000);
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
        // Only add to pending if the slot's END time is in the past
        const slotEnd = new Date(slot.getTime() + (0, time_1.getSlotMinutes)() * 60000);
        if (!includeFuture && slotEnd.getTime() > now.getTime())
            break; // stop at first slot that hasn't ended
        const key = (0, time_1.slotKey)(slot);
        if (!done.has(key))
            enqueuePending(key, { silent: true });
    }
    // Single emit after bulk rebuild
    try {
        win?.webContents.send('queue:updated');
    }
    catch { }
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
        // Only add to pending if the slot's END time is in the past
        const slotEnd = new Date(slot.getTime() + (0, time_1.getSlotMinutes)() * 60000);
        const key = (0, time_1.slotKey)(slot);
        if (existing.has(key))
            continue; // already logged
        if (!includeFuture && slotEnd.getTime() > now.getTime())
            break; // stop at first slot that hasn't ended
        if (!doneOrLogged(key))
            enqueuePending(key, { silent: true });
    }
    try {
        win?.webContents.send('queue:updated');
    }
    catch { }
    function doneOrLogged(key) { return existing.has(key); }
}
// IPC handlers
console.log('[main] registering IPC handlers...');
electron_1.ipcMain.handle('db:get-day', (_e, day) => (0, db_1.getDayEntries)(day));
electron_1.ipcMain.handle('db:get-days', () => (0, db_1.getDays)());
electron_1.ipcMain.handle('db:get-external-logged', (_e, day) => ({ day, exported: (0, db_2.getExternalLogged)(day) }));
electron_1.ipcMain.handle('db:set-external-logged', (_e, day, exported) => (0, db_2.setExternalLogged)(day, exported));
electron_1.ipcMain.handle('db:save-entries', (_e, entries) => (0, db_1.saveEntries)(entries));
electron_1.ipcMain.handle('db:import-external', (_e, raw) => {
    try {
        const result = (0, db_1.importExternalLines)(String(raw ?? ''));
        // After import refresh pending/backlog since newly added slots should not remain pending.
        rebuildBacklogForToday({ includeFuture: false });
        return { ok: true, ...result };
    }
    catch (e) {
        return { ok: false, error: String(e) };
    }
});
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
    // When enabling mid-workday we now WAIT until next boundary (end of current slot) instead of immediate catch-up.
    restartTickerIfWorkdayNow();
    // Apply auto-start setting (Windows/macOS)
    try {
        electron_1.app.setLoginItemSettings({ openAtLogin: !!after.auto_start_on_login });
    }
    catch { }
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
        if (shouldRequeue)
            enqueuePending(`${day}T${start}`); // emits queue:updated
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
        if (pending.has(k))
            pending.delete(k);
    });
    groupedByDay.forEach((list) => (0, db_1.saveEntries)(list));
    // Notify renderer that pending slots were consumed so its badge clears quickly (optimistic before loadPending).
    try {
        win?.webContents.send('queue:updated');
    }
    catch { }
    // Update lastEntryEndTime for today
    try {
        const today = (0, time_1.toLocalDateYMD)(new Date());
        const todayEntries = (0, db_1.getDayEntries)(today);
        if (todayEntries.length) {
            const last = todayEntries[todayEntries.length - 1];
            if (last?.end) {
                const [hh, mm] = last.end.split(':').map(Number);
                const [y, mo, d] = today.split('-').map(Number);
                lastEntryEndTime = new Date(y, (mo || 1) - 1, d || 1, hh, mm, 0, 0);
            }
        }
    }
    catch { }
    updateTrayTooltip();
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
        win?.webContents.send('dialog:open-log', { slot: (0, time_1.slotKey)(slot) });
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
    // Create tray icon
    try {
        const iconPath = node_path_1.default.join(__dirname, 'icon.png');
        let img;
        try {
            img = electron_1.nativeImage.createFromPath(iconPath);
        }
        catch { }
        tray = new electron_1.Tray(img && !img.isEmpty() ? img : electron_1.nativeImage.createEmpty());
        updateTrayTooltip();
        // Provide a context menu so user can interact with the app from the tray
        try {
            const trayMenu = electron_1.Menu.buildFromTemplate([
                {
                    label: 'Vis / Skjul',
                    click: () => {
                        if (!win)
                            return;
                        try {
                            if (win.isVisible()) {
                                win.hide();
                            }
                            else {
                                win.show();
                                win.focus();
                            }
                        }
                        catch { }
                    }
                },
                {
                    label: 'Log nu',
                    click: () => {
                        if (!win)
                            return;
                        try {
                            win.show();
                            win.focus();
                        }
                        catch { }
                        // Open prompt for the slot that just finished (previous slot) so user can log immediately.
                        const prev = (0, time_1.previousSlotStart)(new Date());
                        const key = (0, time_1.slotKey)(prev);
                        // Emit both prompt (for selection logic) and a manual dialog open event that bypasses handledPromptSlot gating.
                        win?.webContents.send('prompt:open', { slot: key });
                        win?.webContents.send('dialog:open-log', { slot: key });
                    }
                },
                {
                    label: 'Log alle ventende',
                    click: () => {
                        if (!win)
                            return;
                        try {
                            win.show();
                            win.focus();
                        }
                        catch { }
                        // Only open bulk dialog if there are pending slots
                        if (pending.size > 0) {
                            win?.webContents.send('dialog:open-log-all');
                        }
                        else {
                            // Optionally could show a notification; for now silently ignore.
                            console.log('[main] bulk log requested but no pending slots');
                        }
                    }
                },
                {
                    label: 'Gå til i dag',
                    click: () => {
                        if (!win)
                            return;
                        try {
                            win.show();
                            win.focus();
                        }
                        catch { }
                        // Send explicit navigate event for today summary view
                        const today = (0, time_1.toLocalDateYMD)(new Date());
                        win?.webContents.send('navigate:today', { day: today });
                    }
                },
                { type: 'separator' },
                {
                    label: 'Afslut',
                    click: () => { try {
                        electron_1.app.quit();
                    }
                    catch { } }
                }
            ]);
            tray.setContextMenu(trayMenu);
            // Left-click toggles window visibility for quick access
            tray.on('click', () => {
                if (!win)
                    return;
                try {
                    if (win.isVisible()) {
                        // On Windows a single click often means "show"; keep behavior consistent: always show & focus
                        win.focus();
                    }
                    else {
                        win.show();
                        win.focus();
                    }
                }
                catch { }
            });
        }
        catch (menuErr) {
            console.error('[main] tray menu init failed', menuErr);
        }
    }
    catch (e) {
        console.error('[main] tray init failed', e);
    }
    // Remove default application menu (we provide custom controls in renderer)
    try {
        electron_1.Menu.setApplicationMenu(null);
    }
    catch { }
    console.log('[main] rebuilding backlog for today...');
    rebuildBacklogForToday({ includeFuture: false });
    console.log('[main] scheduling ticker for notifications...');
    scheduleTicker();
    scheduleStaleCheck();
    console.log('[main] initialization complete.');
    // Signal to renderer that core initialization (handlers + DB + window) is complete
    win?.webContents.send('app:ready');
    console.log('[main] registering app event handlers...');
    electron_1.app.on('activate', () => {
        console.log('[main] app activate event');
        if (electron_1.BrowserWindow.getAllWindows().length === 0)
            createWindow();
    });
    electron_1.app.on('browser-window-focus', () => {
        // Flush digest queue when user returns
        if (digestQueue.length) {
            showDigestNotification();
        }
    });
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
        electron_1.app.quit();
});
// Clear timers proactively on quit to avoid lingering handles (housekeeping hardening)
electron_1.app.on('before-quit', () => {
    try {
        if (tickerHandle)
            clearTimeout(tickerHandle);
    }
    catch { }
    try {
        if (staleCheckHandle)
            clearInterval(staleCheckHandle);
    }
    catch { }
    tickerHandle = null;
    staleCheckHandle = null;
});
//# sourceMappingURL=main.js.map