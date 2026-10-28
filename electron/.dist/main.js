"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
// electron/main.ts
const electron_1 = require("electron");
const node_path_1 = tslib_1.__importDefault(require("node:path"));
const node_fs_1 = tslib_1.__importDefault(require("node:fs"));
const node_https_1 = tslib_1.__importDefault(require("node:https"));
// Lightweight structured logging to file + console. Rotates by day (new file per day).
function ensureLogDir() {
    const dir = node_path_1.default.join(electron_1.app.getPath('userData'), 'logs');
    try {
        if (!node_fs_1.default.existsSync(dir))
            node_fs_1.default.mkdirSync(dir, { recursive: true });
    }
    catch { /* ignore */ }
    return dir;
}
function currentLogFile() {
    const day = new Date().toISOString().slice(0, 10);
    return node_path_1.default.join(ensureLogDir(), `app-${day}.log`);
}
function writeLog(level, message, meta) {
    try {
        const ts = new Date().toISOString();
        const line = JSON.stringify({ ts, level, message, meta: meta ?? null });
        // Console echo (condensed)
        const prefix = `[${level}]`;
        if (level === 'error')
            console.error(prefix, message, meta ?? '');
        else if (level === 'warn')
            console.warn(prefix, message, meta ?? '');
        else
            console.log(prefix, message, meta ?? '');
        node_fs_1.default.appendFile(currentLogFile(), line + '\n', () => { });
    }
    catch (e) { /* last-chance; avoid throwing in logger */ }
}
// On-prem Jira uses a corporate CA that Node does not trust; Cloud uses normal TLS verification.
const corporateJiraAgent = new node_https_1.default.Agent({ rejectUnauthorized: false });
function jiraRequest(connection, method, url, body) {
    return new Promise((resolve, reject) => {
        const bodyStr = body === undefined ? undefined : JSON.stringify(body);
        const headers = { ...(0, jira_client_1.jiraAuthHeaders)(connection) };
        if (bodyStr !== undefined) {
            headers['Content-Type'] = 'application/json';
            headers['Content-Length'] = Buffer.byteLength(bodyStr);
        }
        const req = node_https_1.default.request(url, {
            method,
            headers,
            agent: connection.type === 'server' ? corporateJiraAgent : undefined
        }, (res) => {
            const chunks = [];
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
        if (bodyStr !== undefined)
            req.write(bodyStr);
        req.end();
    });
}
let fatalShutdownInProgress = false;
function handleFatalProcessError(kind, error) {
    const err = error;
    writeLog(kind, err?.message || String(error), {
        stack: err?.stack,
        reason: kind === 'unhandledRejection' ? error : undefined
    });
    // Prevent duplicate shutdown attempts when multiple fatal errors arrive.
    if (fatalShutdownInProgress)
        return;
    fatalShutdownInProgress = true;
    try {
        win?.webContents.send('app:fatal-error', { kind, message: err?.message || String(error) });
    }
    catch { }
    if (!electron_1.app.isPackaged) {
        // Keep development sessions alive for faster debugging after logging the failure.
        fatalShutdownInProgress = false;
        return;
    }
    setTimeout(() => {
        try {
            electron_1.app.exit(1);
        }
        catch { }
    }, 1500);
    try {
        electron_1.app.quit();
    }
    catch { }
}
// Capture process-level failures early
process.on('uncaughtException', (err) => {
    handleFatalProcessError('uncaughtException', err);
});
process.on('unhandledRejection', (reason) => {
    handleFatalProcessError('unhandledRejection', reason);
});
const db_1 = require("./db");
const island_1 = require("./island");
const stale_1 = require("./stale");
const db_2 = require("./db");
const auth_1 = require("./auth");
const time_1 = require("./time");
const work_schedule_1 = require("./work-schedule");
const jira_search_1 = require("./jira-search");
const jira_client_1 = require("./jira-client");
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
const jiraMyselfCache = new Map();
let windowMode = 'compact';
let expandedHeight = island_1.EXPANDED_DEFAULT_HEIGHT;
let lastProgrammaticBoundsAt = 0;
let restoreBoundsBeforeMaximize = null;
let pointerDrag = null;
let snapHintActive = false;
let dockCenterRatio = 0.5;
let compactIdle = true;
function jiraIdentityCacheKey(c) {
    return [c.type, c.base_url, c.email, c.token].join('|');
}
async function resolveJiraIdentity(connection) {
    if ((0, jira_client_1.jiraConnectionMissingConfig)(connection))
        return undefined;
    const cacheKey = jiraIdentityCacheKey(connection);
    const cached = jiraMyselfCache.get(cacheKey);
    if (cached)
        return { ...cached };
    try {
        const res = await jiraRequest(connection, 'GET', (0, jira_client_1.buildJiraMyselfUrl)(connection));
        if (!res.ok) {
            jiraMyselfCache.set(cacheKey, {});
            return undefined;
        }
        const data = await res.json();
        const accountId = (0, jira_client_1.jiraUserIdFromMyself)(connection, data);
        const displayName = String(data.displayName ?? '').trim() || undefined;
        const emailAddress = String(data.emailAddress ?? '').trim() || undefined;
        jiraMyselfCache.set(cacheKey, { accountId, displayName, emailAddress });
        return { accountId, displayName, emailAddress };
    }
    catch {
        jiraMyselfCache.set(cacheKey, {});
        return undefined;
    }
}
function getActiveJiraConnection() {
    const settings = (0, db_1.getSettings)();
    return (0, jira_client_1.resolveJiraConnection)(settings.jira_connections, settings.jira_active_connection_id);
}
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
function currentWorkArea() {
    if (win)
        return electron_1.screen.getDisplayMatching(win.getBounds()).workArea;
    return electron_1.screen.getPrimaryDisplay().workArea;
}
function currentDockArea() {
    const display = win ? electron_1.screen.getDisplayMatching(win.getBounds()) : electron_1.screen.getPrimaryDisplay();
    return { ...display.workArea, y: display.bounds.y, height: display.workArea.y + display.workArea.height - display.bounds.y };
}
function setBoundsProgrammatically(bounds) {
    if (!win)
        return;
    lastProgrammaticBoundsAt = Date.now();
    win.setBounds(bounds);
}
function dockedSize(mode) {
    return mode === 'expanded' ? { width: island_1.EXPANDED_WIDTH, height: expandedHeight } : (compactIdle ? island_1.IDLE_SIZE : island_1.COMPACT_SIZE);
}
function dockedBounds(mode) {
    return (0, island_1.computeDockedBounds)(currentDockArea(), dockedSize(mode), dockCenterRatio);
}
function resolveDetachedBounds(workArea) {
    const saved = (0, db_1.getSettings)().detached_bounds;
    if ((0, island_1.isUsableRect)(saved))
        return (0, island_1.clampToWorkArea)(saved, electron_1.screen.getDisplayMatching(saved).workArea);
    const width = Math.min(island_1.DEFAULT_DETACHED_SIZE.width, workArea.width);
    const height = Math.min(island_1.DEFAULT_DETACHED_SIZE.height, workArea.height);
    return {
        x: Math.round(workArea.x + (workArea.width - width) / 2),
        y: Math.round(workArea.y + (workArea.height - height) / 2),
        width,
        height
    };
}
function persistDetachedBounds() {
    if (!win || windowMode !== 'detached' || restoreBoundsBeforeMaximize)
        return;
    try {
        (0, db_1.updateWindowState)({ detached_bounds: win.getBounds() });
    }
    catch (e) {
        console.warn('[main] persist bounds failed', e);
    }
}
function sendMaximizeState() {
    try {
        win?.webContents.send('window:maximize-state', { maximized: !!restoreBoundsBeforeMaximize });
    }
    catch { }
}
function setSnapHint(active) {
    if (snapHintActive === active)
        return;
    snapHintActive = active;
    try {
        win?.webContents.send('island:snap-hint', { active });
    }
    catch { }
}
function applyWindowMode(mode, opts = {}) {
    if (!win)
        return;
    const prev = windowMode;
    windowMode = mode;
    setSnapHint(false);
    if ((0, island_1.isDockedMode)(mode)) {
        if (restoreBoundsBeforeMaximize) {
            restoreBoundsBeforeMaximize = null;
            sendMaximizeState();
        }
        win.setSkipTaskbar(true);
        win.setAlwaysOnTop(true, 'floating');
        setBoundsProgrammatically(dockedBounds(mode));
    }
    else {
        win.setAlwaysOnTop(false);
        win.setSkipTaskbar(false);
        setBoundsProgrammatically(opts.bounds ?? resolveDetachedBounds(currentWorkArea()));
    }
    if (opts.focus || (mode === 'detached' && prev !== 'detached')) {
        try {
            if (win.isMinimized())
                win.restore();
            win.show();
            win.focus();
            win.webContents.focus();
        }
        catch { }
    }
    if ((0, island_1.isDockedMode)(prev) !== (0, island_1.isDockedMode)(mode)) {
        try {
            (0, db_1.updateWindowState)({ window_mode: (0, island_1.isDockedMode)(mode) ? 'docked' : 'detached' });
        }
        catch { }
    }
    try {
        win.webContents.send('window:mode', { mode });
    }
    catch { }
}
/** Visible docked island takes over slot prompts from OS toasts. */
function islandVisible() {
    return !!win && (0, island_1.isDockedMode)(windowMode) && win.isVisible() && !win.isMinimized();
}
function pulseIsland(kind, slot) {
    try {
        win?.webContents.send('island:pulse', { kind, slot });
    }
    catch { }
}
function bringWindowToFront() {
    if (!win)
        return;
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
    // Docked island is permanently on top; only flash top-most for the detached window.
    if (windowMode === 'detached') {
        try {
            win.setAlwaysOnTop(true);
            win.focus();
            setTimeout(() => { try {
                if (windowMode === 'detached')
                    win?.setAlwaysOnTop(false);
            }
            catch { } }, 400);
        }
        catch { }
    }
}
function redockAfterDisplayChange() {
    if (!win)
        return;
    if ((0, island_1.isDockedMode)(windowMode)) {
        applyWindowMode(windowMode);
        return;
    }
    const b = win.getBounds();
    setBoundsProgrammatically((0, island_1.clampToWorkArea)(b, electron_1.screen.getDisplayMatching(b).workArea));
}
function createWindow() {
    const settings = (0, db_1.getSettings)();
    windowMode = settings.window_mode === 'detached' ? 'detached' : 'compact';
    dockCenterRatio = Number.isFinite(settings.dock_center_ratio) ? Number(settings.dock_center_ratio) : 0.5;
    const primaryWorkArea = electron_1.screen.getPrimaryDisplay().workArea;
    const docked = (0, island_1.isDockedMode)(windowMode);
    const initialBounds = docked
        ? dockedBounds('compact')
        : resolveDetachedBounds(primaryWorkArea);
    win = new electron_1.BrowserWindow({
        ...initialBounds,
        show: false,
        frame: false, // frameless so we can draw custom title bar + window controls
        titleBarStyle: 'hidden', // hide native title bar (macOS shows traffic lights inset if frame true)
        title: 'JF LoggR',
        // Transparent so the island pill and rounded detached shell can float over the desktop.
        transparent: true,
        backgroundColor: '#00000000',
        hasShadow: false,
        // Transparent windows resize unreliably on Windows; renderer provides custom resize grips.
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        alwaysOnTop: docked,
        skipTaskbar: docked,
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
        // DevTools draws a size overlay on every island resize, so only open it on request.
        if (process.env['ELECTRON_DEVTOOLS'] === '1')
            win.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        win.loadFile(node_path_1.default.join(__dirname, '../../dist/work-logger/browser/index.html'));
    }
    if (!electron_1.app.isPackaged) {
        win.webContents.on('before-input-event', (_e, input) => {
            if (input.type === 'keyDown' && input.key === 'F12')
                win?.webContents.toggleDevTools();
        });
    }
    if (docked)
        win.setAlwaysOnTop(true, 'floating');
    win.on('ready-to-show', () => win?.show());
    win.webContents.on('did-finish-load', () => {
        try {
            win?.webContents.send('window:mode', { mode: windowMode });
        }
        catch { }
    });
    const isUserBoundsChange = () => windowMode === 'detached' && !pointerDrag && Date.now() - lastProgrammaticBoundsAt > 400;
    win.on('move', () => {
        if (!win || !isUserBoundsChange() || restoreBoundsBeforeMaximize)
            return;
        setSnapHint((0, island_1.shouldSnapToDock)(win.getBounds(), currentWorkArea()));
    });
    win.on('moved', () => {
        if (!isUserBoundsChange())
            return;
        if (snapHintActive) {
            applyWindowMode('compact');
            return;
        }
        if (restoreBoundsBeforeMaximize) {
            restoreBoundsBeforeMaximize = null;
            sendMaximizeState();
        }
        persistDetachedBounds();
    });
    win.on('resized', () => { if (isUserBoundsChange())
        persistDetachedBounds(); });
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
            bringWindowToFront();
            // Open prompt for earliest slot captured at notification creation time.
            win?.webContents.send('prompt:open', { slot: (0, time_1.slotKey)(firstSlot), source: 'notification' });
            // Force open dialog even if slot was previously handled so user can re-log or review.
            win?.webContents.send('dialog:open-log', { slot: (0, time_1.slotKey)(firstSlot), source: 'notification' });
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
    const slotEnd = new Date(slot.getTime() + slotLen * 60000);
    const endHh = `${slotEnd.getHours()}`.padStart(2, '0');
    const endMm = `${slotEnd.getMinutes()}`.padStart(2, '0');
    const body = `Log ${day} ${hh}:${mm}–${endHh}:${endMm}`;
    const st = (0, db_1.getSettings)();
    if (islandVisible()) {
        pulseIsland('slot', (0, time_1.slotKey)(slot));
        win?.webContents.send('prompt:open', { slot: (0, time_1.slotKey)(slot), source: 'island' });
        if (!st.island_os_notifications)
            return;
    }
    const n = new electron_1.Notification({ title: 'Tid til at registér tid', body, silent: !!st.notification_silent });
    n.on('click', () => {
        if (win) {
            bringWindowToFront();
            console.log('[main] notification click -> prompt:open', (0, time_1.slotKey)(slot));
            win?.webContents.send('prompt:open', { slot: (0, time_1.slotKey)(slot), source: 'notification' });
            // Also force dialog open regardless of prior handled state.
            win?.webContents.send('dialog:open-log', { slot: (0, time_1.slotKey)(slot), source: 'notification' });
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
        const prevStart = (0, time_1.previousSlotStart)(boundary); // Slot that just finished
        if ((0, time_1.shouldPromptForFinishedSlot)(boundary, prevStart)) {
            const gran = (0, time_1.getSlotMinutes)();
            try {
                console.log('[main] tick boundary', { boundary: boundary.toISOString(), gran, prevStart: (0, time_1.slotKey)(prevStart) });
            }
            catch { }
            const sDyn = (0, db_1.getSettings)();
            const key = (0, time_1.slotKey)(prevStart);
            // Guard against re-queueing already logged slot
            const day = (0, time_1.toLocalDateYMD)(prevStart);
            const alreadyLogged = isSlotCoveredByEntries(prevStart, (0, db_1.getDayEntries)(day));
            if (!alreadyLogged) {
                enqueuePending(key); // emits queue:updated
                try {
                    console.log('[main] enqueue prevStart', key, 'pending size', pending.size);
                }
                catch { }
                notifyForSlot(prevStart);
                if (sDyn.auto_focus_on_slot && win) {
                    bringWindowToFront();
                    console.log('[main] auto-focus tick -> prompt:open (previous slot just finished)', key);
                    win?.webContents.send('prompt:open', { slot: key, source: 'auto-focus' });
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
                if (islandVisible()) {
                    pulseIsland('stale', result.key);
                    if (!st.island_os_notifications)
                        return;
                }
                const n = new electron_1.Notification({ title: 'Overvokset interval', body, silent: !!st.notification_silent });
                n.on('click', () => {
                    if (win) {
                        bringWindowToFront();
                        win?.webContents.send('prompt:open', { slot: result.key, source: 'notification' });
                        win?.webContents.send('dialog:open-log', { slot: result.key, source: 'notification' });
                    }
                });
                n.show();
            }
        }
        catch { /* ignore */ }
    }, 60000);
}
function hmToMinutes(hm) {
    const { h, m } = (0, time_1.parseHM)(String(hm ?? '00:00'));
    return h * 60 + m;
}
/** Returns true when slot start is already covered by an existing logged interval on that day. */
function isSlotCoveredByEntries(slotStart, entries) {
    const slotStartMinutes = slotStart.getHours() * 60 + slotStart.getMinutes();
    for (const e of entries) {
        const startM = hmToMinutes(e.start);
        const endM = hmToMinutes(e.end);
        if (!Number.isFinite(startM) || !Number.isFinite(endM) || endM <= startM)
            continue;
        if (slotStartMinutes >= startM && slotStartMinutes < endM)
            return true;
    }
    return false;
}
function rebuildBacklogForToday({ includeFuture = false } = {}) {
    // Build backlog only for finished unlogged slots.
    const now = new Date();
    const day = (0, time_1.toLocalDateYMD)(now);
    const dayEntries = (0, db_1.getDayEntries)(day);
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
        if (!isSlotCoveredByEntries(slot, dayEntries))
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
    const dayEntries = (0, db_1.getDayEntries)(day);
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
        if (isSlotCoveredByEntries(slot, dayEntries))
            continue; // already logged by an interval covering this slot
        if (!includeFuture && slotEnd.getTime() > now.getTime())
            break; // stop at first slot that hasn't ended
        enqueuePending(key, { silent: true });
    }
    try {
        win?.webContents.send('queue:updated');
    }
    catch { }
}
function logIpcFailure(channel, err) {
    const error = err;
    writeLog('error', `IPC handler failed: ${channel}`, {
        message: error?.message ?? String(err),
        stack: error?.stack
    });
}
// IPC handlers
console.log('[main] registering IPC handlers...');
electron_1.ipcMain.handle('db:get-day', (_e, day) => {
    try {
        return (0, db_1.getDayEntries)(day);
    }
    catch (e) {
        logIpcFailure('db:get-day', e);
        throw e;
    }
});
electron_1.ipcMain.handle('db:get-days', () => {
    try {
        return (0, db_1.getDays)();
    }
    catch (e) {
        logIpcFailure('db:get-days', e);
        throw e;
    }
});
electron_1.ipcMain.handle('db:get-external-logged', (_e, day) => ({ day, exported: (0, db_2.getExternalLogged)(day) }));
electron_1.ipcMain.handle('db:set-external-logged', (_e, day, exported) => (0, db_2.setExternalLogged)(day, exported));
electron_1.ipcMain.handle('db:save-entries', (_e, entries) => {
    try {
        return (0, db_1.saveEntries)(entries);
    }
    catch (e) {
        logIpcFailure('db:save-entries', e);
        throw e;
    }
});
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
electron_1.ipcMain.handle('db:get-summary', (_e, day) => {
    try {
        return (0, db_1.getSummary)(day);
    }
    catch (e) {
        logIpcFailure('db:get-summary', e);
        throw e;
    }
});
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
electron_1.ipcMain.handle('auth:get-status', () => auth_1.azureAuth.getStatus());
electron_1.ipcMain.handle('auth:signin', async () => {
    const result = await auth_1.azureAuth.signInInteractive();
    if (!result.ok) {
        writeLog('warn', 'Azure sign-in failed', { error: result.error });
    }
    return result;
});
electron_1.ipcMain.handle('auth:signout', async () => {
    const result = await auth_1.azureAuth.signOut();
    writeLog('info', 'Azure sign-out completed');
    return result;
});
electron_1.ipcMain.handle('jira:search-issues', async (_e, payload) => {
    try {
        const term = String(payload?.term ?? '').trim();
        if (term.length < 2)
            return { ok: true, items: [] };
        const connection = getActiveJiraConnection();
        const missing = (0, jira_client_1.jiraConnectionMissingConfig)(connection);
        if (missing || !connection)
            return { ok: false, error: missing ?? 'Jira er ikke konfigureret.' };
        const projectKey = connection.project_key;
        if (!projectKey) {
            return { ok: false, error: `Jira project key mangler for "${connection.name}".` };
        }
        const escapedTerm = term.replace(/"/g, '\\"');
        const keyCandidate = term.toUpperCase().replace(/"/g, '\\"');
        const clauses = [`summary ~ "${escapedTerm}*"`];
        if (/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(term)) {
            clauses.unshift(`key = "${keyCandidate}"`);
        }
        const jql = `project = "${projectKey}" AND (${clauses.join(' OR ')}) ORDER BY created DESC`;
        const url = (0, jira_client_1.buildJiraSearchUrl)(connection, jql, ['key', 'summary', 'issuetype', 'assignee', 'reporter', 'customfield_10060'], 10);
        const res = await jiraRequest(connection, 'GET', url);
        if (!res.ok) {
            return { ok: false, error: `Jira opslag fejlede (${res.status}).` };
        }
        const data = await res.json();
        const currentAccountId = (await resolveJiraIdentity(connection))?.accountId;
        const items = (0, jira_search_1.mapAndRankJiraIssues)(data.issues ?? [], term, currentAccountId);
        return { ok: true, items };
    }
    catch (e) {
        console.log('Jira search failed', e);
        logIpcFailure('jira:search-issues', e);
        return { ok: false, error: 'Jira opslag fejlede.' };
    }
});
electron_1.ipcMain.handle('jira:verify-identity', async (_e, payload) => {
    try {
        // Settings UI may verify unsaved connection drafts.
        const connection = payload?.connection !== undefined
            ? (0, jira_client_1.normalizeJiraConnection)(payload.connection) ?? undefined
            : getActiveJiraConnection();
        const missing = (0, jira_client_1.jiraConnectionMissingConfig)(connection);
        if (missing || !connection) {
            return { ok: false, error: missing ?? 'Jira er ikke konfigureret.' };
        }
        const identity = await resolveJiraIdentity(connection);
        if (!identity?.accountId) {
            return { ok: false, error: `Login kunne ikke verificeres mod Jira /myself (${connection.name}).` };
        }
        return {
            ok: true,
            accountId: identity.accountId,
            displayName: identity.displayName,
            emailAddress: identity.emailAddress
        };
    }
    catch (e) {
        logIpcFailure('jira:verify-identity', e);
        return { ok: false, error: 'Jira verifikation fejlede.' };
    }
});
// Categories in 'Udvikling Projekter' group that support Jira worklog posting
const JIRA_WORKLOG_CATEGORIES = new Set([
    'Udvikling (prioriterede jf. projektoversigten)',
    'Estimering'
]);
electron_1.ipcMain.handle('jira:log-worklog', async (_e, payload) => {
    try {
        const day = String(payload?.day ?? '').trim();
        if (!day)
            return { ok: false, error: 'Dag mangler.' };
        const connection = getActiveJiraConnection();
        const missing = (0, jira_client_1.jiraConnectionMissingConfig)(connection);
        if (missing || !connection)
            return { ok: false, error: missing ?? 'Jira er ikke konfigureret.' };
        const entries = (0, db_1.getDayEntries)(day).filter((e) => JIRA_WORKLOG_CATEGORIES.has(e.category));
        if (!entries.length)
            return { ok: true, results: [] };
        // Aggregate seconds + earliest start per Jira key
        const aggr = new Map();
        for (const entry of entries) {
            const m = entry.description?.match(/^([A-Z]+-\d+)\s*-\s*/);
            if (!m)
                continue;
            const key = m[1];
            const [sh, sm] = entry.start.split(':').map(Number);
            const [eh, em] = entry.end.split(':').map(Number);
            const seconds = ((eh * 60 + em) - (sh * 60 + sm)) * 60;
            if (seconds <= 0)
                continue;
            const existing = aggr.get(key);
            if (existing) {
                existing.seconds += seconds;
                if (entry.start < existing.earliest)
                    existing.earliest = entry.start;
            }
            else {
                aggr.set(key, { seconds, earliest: entry.start });
            }
        }
        if (!aggr.size)
            return { ok: true, results: [] };
        const [y, mo, d] = day.split('-').map(Number);
        const results = [];
        const tracked = [];
        for (const [key, { seconds, earliest }] of aggr) {
            try {
                const [hh, mm] = earliest.split(':').map(Number);
                const started = new Date(y, (mo || 1) - 1, d || 1, hh, mm, 0, 0);
                const pad2 = (n) => String(n).padStart(2, '0');
                const tz = -started.getTimezoneOffset();
                const tzSign = tz >= 0 ? '+' : '-';
                const tzH = pad2(Math.floor(Math.abs(tz) / 60));
                const tzM = pad2(Math.abs(tz) % 60);
                const startedStr = `${day}T${pad2(hh)}:${pad2(mm)}:00.000${tzSign}${tzH}${tzM}`;
                const res = await jiraRequest(connection, 'POST', (0, jira_client_1.buildJiraWorklogUrl)(connection, key), (0, jira_client_1.buildJiraWorklogBody)(connection, seconds, startedStr, 'Logged via JFLoggeR'));
                if (res.ok) {
                    const body = await res.json();
                    const worklogId = String(body?.id ?? '').trim();
                    results.push({ key, seconds, success: true, worklogId: worklogId || undefined });
                    if (worklogId) {
                        tracked.push({ key, worklogId, seconds, started: startedStr, logged_at: new Date().toISOString(), connection_id: connection.id });
                    }
                }
                else {
                    const body = await res.json().catch(() => undefined);
                    results.push({ key, seconds, success: false, error: (0, jira_client_1.describeJiraHttpError)(res.status, body) });
                }
            }
            catch (e) {
                results.push({ key, seconds, success: false, error: String(e) });
            }
        }
        if (tracked.length)
            (0, db_1.setJiraLoggedWorklogs)(day, tracked);
        else
            (0, db_1.clearJiraLoggedWorklogs)(day);
        const failed = results.filter(r => !r.success);
        if (failed.length) {
            writeLog('warn', 'Jira worklog failed', { connection: connection.name, failed });
            return { ok: false, results, error: failed.map(r => `${r.key}: ${r.error}`).join(' | ') };
        }
        return { ok: true, results };
    }
    catch (e) {
        logIpcFailure('jira:log-worklog', e);
        return { ok: false, error: 'Jira worklog fejlede.' };
    }
});
electron_1.ipcMain.handle('jira:unset-afstemt', async (_e, payload) => {
    try {
        const day = String(payload?.day ?? '').trim();
        if (!day)
            return { ok: false, day, exported: true, error: 'Dag mangler.' };
        const tracked = (0, db_1.getJiraLoggedWorklogs)(day);
        if (!tracked.length) {
            const status = (0, db_2.setExternalLogged)(day, false);
            return { ok: true, ...status, removed: 0, total: 0, results: [] };
        }
        const settings = (0, db_1.getSettings)();
        const results = [];
        const remaining = [];
        // Worklogs are deleted on the instance they were created on, regardless of the active connection.
        for (const row of tracked) {
            const connection = (0, jira_client_1.resolveJiraConnection)(settings.jira_connections, row.connection_id);
            const missing = connection
                ? (0, jira_client_1.jiraConnectionMissingConfig)(connection)
                : 'Jira-forbindelsen, som worklog blev oprettet på, findes ikke længere i indstillinger.';
            if (missing || !connection) {
                remaining.push(row);
                results.push({ key: row.key, worklogId: row.worklogId, success: false, error: missing ?? undefined });
                continue;
            }
            try {
                const res = await jiraRequest(connection, 'DELETE', (0, jira_client_1.buildJiraWorklogUrl)(connection, row.key, row.worklogId));
                if (res.ok || res.status === 404) {
                    results.push({ key: row.key, worklogId: row.worklogId, success: true });
                }
                else {
                    remaining.push(row);
                    const body = await res.json().catch(() => undefined);
                    results.push({ key: row.key, worklogId: row.worklogId, success: false, error: (0, jira_client_1.describeJiraHttpError)(res.status, body) });
                }
            }
            catch (e) {
                remaining.push(row);
                results.push({ key: row.key, worklogId: row.worklogId, success: false, error: String(e) });
            }
        }
        if (remaining.length) {
            (0, db_1.setJiraLoggedWorklogs)(day, remaining);
            return {
                ok: false,
                day,
                exported: true,
                removed: tracked.length - remaining.length,
                total: tracked.length,
                results,
                error: `Kunne ikke fjerne alle Jira worklogs. ${results.find((r) => !r.success)?.error ?? 'Prøv igen.'}`
            };
        }
        (0, db_1.clearJiraLoggedWorklogs)(day);
        const status = (0, db_2.setExternalLogged)(day, false);
        return {
            ok: true,
            ...status,
            removed: tracked.length,
            total: tracked.length,
            results
        };
    }
    catch (e) {
        logIpcFailure('jira:unset-afstemt', e);
        return { ok: false, exported: true, error: 'Kunne ikke fjerne Jira worklogs.' };
    }
});
electron_1.ipcMain.handle('jira:get-logged-worklogs', async (_e, payload) => {
    try {
        const day = String(payload?.day ?? '').trim();
        if (!day)
            return { ok: false, items: [], error: 'Dag mangler.' };
        const tracked = (0, db_1.getJiraLoggedWorklogs)(day);
        if (!tracked.length)
            return { ok: true, items: [] };
        // Build key -> task summary map from current day entries.
        const summaryByKey = new Map();
        const dayEntries = (0, db_1.getDayEntries)(day);
        for (const entry of dayEntries) {
            const desc = String(entry?.description ?? '').trim();
            const m = desc.match(/^([A-Z]+-\d+)\s*-\s*(.+)$/);
            if (!m)
                continue;
            const key = m[1];
            const summary = String(m[2] ?? '').trim();
            if (!summary)
                continue;
            if (!summaryByKey.has(key))
                summaryByKey.set(key, summary);
        }
        const items = tracked.map((row) => ({
            key: row.key,
            worklogId: row.worklogId,
            seconds: row.seconds,
            started: row.started,
            logged_at: row.logged_at,
            summary: summaryByKey.get(row.key) ?? ''
        }));
        return { ok: true, items };
    }
    catch (e) {
        logIpcFailure('jira:get-logged-worklogs', e);
        return { ok: false, items: [], error: 'Kunne ikke hente Jira worklog preview.' };
    }
});
// Delete single entry and (re)queue slot if it's in the past, allowing user to relog it
electron_1.ipcMain.handle('db:delete-entry', (_e, day, start) => {
    try {
        const removed = (0, db_1.deleteEntry)(day, start);
        try {
            // If the slot is in the past (earlier than now), add back to pending so user can re-log
            const [y, m, d] = day.split('-').map(Number);
            const [hh, mm] = start.split(':').map(Number);
            const slotDate = new Date(y, (m || 1) - 1, d, hh, mm, 0, 0);
            const now = new Date();
            const isToday = day === (0, time_1.toLocalDateYMD)(now);
            const isScheduled = (0, work_schedule_1.usesWeeklySchedule)((0, db_1.getSettings)()) ? (0, time_1.isWorkTime)(slotDate) : (0, time_1.isWorkdayEnabled)(slotDate);
            const shouldRequeue = isToday && slotDate.getTime() < now.getTime() && isScheduled;
            if (shouldRequeue)
                enqueuePending(`${day}T${start}`); // emits queue:updated
        }
        catch { /* ignore parse errors */ }
        return { ok: true, removed };
    }
    catch (e) {
        logIpcFailure('db:delete-entry', e);
        return { ok: false, removed: 0, error: String(e) };
    }
});
// Generic renderer -> main log sink
electron_1.ipcMain.handle('log:write', (_e, entry) => {
    try {
        writeLog(entry.level || 'info', entry.message || '', entry.meta);
        return { ok: true };
    }
    catch (e) {
        return { ok: false, error: String(e) };
    }
});
electron_1.ipcMain.handle('queue:get', () => {
    return Array.from(pending).sort();
});
electron_1.ipcMain.handle('queue:submit', (_e, payload) => {
    try {
        if (!payload || !Array.isArray(payload.slots))
            return { ok: false, error: 'Invalid payload' };
        const description = String(payload.description ?? '').trim();
        const category = String(payload.category ?? '').trim();
        if (!description || !category)
            return { ok: false, error: 'Description and category are required' };
        const groupedByDay = new Map();
        const coverageByDay = new Map();
        const consumedKeys = [];
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
                coverageByDay.set(day, (0, db_1.getDayEntries)(day).map(e => ({ start: e.start, end: e.end })));
            }
            const [y, mo, d] = day.split('-').map(Number);
            const slotStart = new Date(y, (mo || 1) - 1, d || 1, hh, mm, 0, 0);
            const dayCoverage = coverageByDay.get(day);
            if (isSlotCoveredByEntries(slotStart, dayCoverage)) {
                consumedKeys.push(k);
                continue;
            }
            const slotLen = (0, time_1.getSlotMinutes)();
            const endTotal = hh * 60 + mm + slotLen;
            const endMin = endTotal % 60;
            const endHour = Math.floor(endTotal / 60) % 24;
            const entry = {
                day,
                start: `${h}:${m}`,
                end: `${String(endHour).padStart(2, '0')}:${String(endMin).padStart(2, '0')}`,
                description,
                category
            };
            if (!groupedByDay.has(day))
                groupedByDay.set(day, []);
            groupedByDay.get(day).push(entry);
            dayCoverage.push({ start: entry.start, end: entry.end });
            consumedKeys.push(k);
        }
        groupedByDay.forEach((list) => (0, db_1.saveEntries)(list));
        for (const key of consumedKeys) {
            if (pending.has(key))
                pending.delete(key);
        }
    }
    catch (e) {
        logIpcFailure('queue:submit', e);
        return { ok: false, error: String(e) };
    }
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
    // The docked island collapses itself after submit; minimizing would hide it.
    if (payload?.minimizeWindowAfterSubmit && windowMode === 'detached') {
        try {
            win?.minimize();
        }
        catch { }
    }
    return { ok: true };
});
// Debug notification trigger (manual test without waiting for scheduler)
electron_1.ipcMain.handle('debug:notify', (_e, opts) => {
    const body = opts?.body ?? 'Test notification';
    const slot = new Date();
    const st = (0, db_1.getSettings)();
    const n = new electron_1.Notification({ title: 'Work Logger (Test)', body, silent: !!st.notification_silent });
    n.on('click', () => {
        bringWindowToFront();
        win?.webContents.send('prompt:open', { slot: (0, time_1.slotKey)(slot), source: 'notification' });
        win?.webContents.send('dialog:open-log', { slot: (0, time_1.slotKey)(slot), source: 'notification' });
    });
    n.show();
    return { ok: true };
});
// Window control handlers (invoked from renderer via preload contextBridge)
electron_1.ipcMain.handle('window:minimize', () => {
    if ((0, island_1.isDockedMode)(windowMode))
        win?.hide();
    else
        win?.minimize();
    return { ok: true };
});
// Transparent windows cannot use native maximize reliably, so maximize = fill the work area.
electron_1.ipcMain.handle('window:toggle-maximize', () => {
    if (!win || windowMode !== 'detached')
        return { ok: false, maximized: false };
    if (restoreBoundsBeforeMaximize) {
        const restore = restoreBoundsBeforeMaximize;
        restoreBoundsBeforeMaximize = null;
        setBoundsProgrammatically(restore);
    }
    else {
        restoreBoundsBeforeMaximize = win.getBounds();
        setBoundsProgrammatically(currentWorkArea());
    }
    sendMaximizeState();
    return { ok: true, maximized: !!restoreBoundsBeforeMaximize };
});
electron_1.ipcMain.handle('window:close', () => {
    if ((0, island_1.isDockedMode)(windowMode))
        win?.hide();
    else
        win?.close();
    return { ok: true };
});
electron_1.ipcMain.handle('island:get-mode', () => ({ mode: windowMode }));
electron_1.ipcMain.handle('island:set-mode', (_e, payload) => {
    const mode = payload?.mode;
    if (mode !== 'compact' && mode !== 'expanded' && mode !== 'detached')
        return { ok: false, mode: windowMode };
    applyWindowMode(mode, { focus: payload?.focus === true });
    return { ok: true, mode: windowMode };
});
// Renderer picks idle vs compact so it can grow the window before, and shrink it after, its CSS morph.
electron_1.ipcMain.handle('island:set-compact-idle', (_e, payload) => {
    const idle = payload?.idle === true;
    if (idle === compactIdle)
        return { ok: true };
    compactIdle = idle;
    if (win && windowMode === 'compact' && !pointerDrag)
        setBoundsProgrammatically(dockedBounds('compact'));
    return { ok: true };
});
electron_1.ipcMain.handle('island:resize', (_e, payload) => {
    const height = Number(payload?.height);
    if (!win || windowMode !== 'expanded' || !Number.isFinite(height))
        return { ok: false };
    expandedHeight = Math.max(island_1.EXPANDED_MIN_HEIGHT, Math.round(height));
    setBoundsProgrammatically(dockedBounds('expanded'));
    return { ok: true };
});
const POINTER_DRAG_KINDS = new Set(['move', 'resize-e', 'resize-s', 'resize-se']);
// Cursor position is read in main so drags stay correct across mixed-DPI displays.
electron_1.ipcMain.on('window:pointer-drag', (_e, payload) => {
    if (!win)
        return;
    const cursor = electron_1.screen.getCursorScreenPoint();
    const phase = payload?.phase;
    if (phase === 'start') {
        const kind = payload?.kind;
        if (!POINTER_DRAG_KINDS.has(kind))
            return;
        if (kind !== 'move' && windowMode !== 'detached')
            return;
        pointerDrag = { kind, cursor, bounds: win.getBounds(), moved: false };
        return;
    }
    if (!pointerDrag)
        return;
    const dx = cursor.x - pointerDrag.cursor.x;
    const dy = cursor.y - pointerDrag.cursor.y;
    if (phase === 'move') {
        if (!pointerDrag.moved && Math.hypot(dx, dy) < 4)
            return;
        pointerDrag.moved = true;
        lastProgrammaticBoundsAt = Date.now();
        if (pointerDrag.kind === 'move' && (0, island_1.isDockedMode)(windowMode)) {
            // Stay pinned to the top edge until pulled down far enough to tear off.
            const area = currentDockArea();
            const x = (0, island_1.clampDockedX)(area, pointerDrag.bounds.x + dx, pointerDrag.bounds.width);
            win.setPosition(x, (0, island_1.shouldDetachFromDrag)(dy) ? pointerDrag.bounds.y + dy : pointerDrag.bounds.y);
        }
        else if (pointerDrag.kind === 'move') {
            win.setPosition(pointerDrag.bounds.x + dx, pointerDrag.bounds.y + dy);
        }
        else {
            win.setBounds((0, island_1.resizeFromDrag)(pointerDrag.bounds, pointerDrag.kind, dx, dy));
        }
        return;
    }
    if (phase !== 'end')
        return;
    const drag = pointerDrag;
    pointerDrag = null;
    if (drag.kind === 'move' && (0, island_1.isDockedMode)(windowMode)) {
        if (drag.moved && (0, island_1.shouldDetachFromDrag)(dy)) {
            const saved = (0, db_1.getSettings)().detached_bounds;
            const size = (0, island_1.isUsableRect)(saved) ? { width: saved.width, height: saved.height } : island_1.DEFAULT_DETACHED_SIZE;
            const workArea = electron_1.screen.getDisplayNearestPoint(cursor).workArea;
            applyWindowMode('detached', { bounds: (0, island_1.detachedBoundsAtCursor)(cursor, size, workArea), focus: true });
            persistDetachedBounds();
        }
        else {
            if (drag.moved) {
                const area = currentDockArea();
                const x = (0, island_1.clampDockedX)(area, drag.bounds.x + dx, drag.bounds.width);
                dockCenterRatio = (0, island_1.dockRatioFromBounds)(area, { x, width: drag.bounds.width });
                try {
                    (0, db_1.updateWindowState)({ dock_center_ratio: dockCenterRatio });
                }
                catch { }
            }
            applyWindowMode(windowMode);
        }
    }
    else if (windowMode === 'detached' && drag.moved) {
        persistDetachedBounds();
    }
});
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
                    label: 'Skift mellem ø og fuld visning',
                    click: () => {
                        if (!win)
                            return;
                        applyWindowMode(windowMode === 'detached' ? 'compact' : 'detached', { focus: true });
                    }
                },
                {
                    label: 'Log nu',
                    click: () => {
                        if (!win)
                            return;
                        bringWindowToFront();
                        // Open prompt for the slot that just finished (previous slot) so user can log immediately.
                        const prev = (0, time_1.previousSlotStart)(new Date());
                        const key = (0, time_1.slotKey)(prev);
                        // Emit both prompt (for selection logic) and a manual dialog open event that bypasses handledPromptSlot gating.
                        win?.webContents.send('prompt:open', { slot: key, source: 'tray' });
                        win?.webContents.send('dialog:open-log', { slot: key, source: 'tray' });
                    }
                },
                {
                    label: 'Log alle ventende',
                    click: () => {
                        if (!win)
                            return;
                        bringWindowToFront();
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
                        if (windowMode !== 'detached')
                            applyWindowMode('detached', { focus: true });
                        else
                            bringWindowToFront();
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
    electron_1.screen.on('display-metrics-changed', redockAfterDisplayChange);
    electron_1.screen.on('display-removed', redockAfterDisplayChange);
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