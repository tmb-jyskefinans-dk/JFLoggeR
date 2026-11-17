"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
// electron/main.ts
const electron_1 = require("electron");
const node_path_1 = tslib_1.__importDefault(require("node:path"));
const node_fs_1 = tslib_1.__importDefault(require("node:fs"));
const node_url_1 = require("node:url");
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
// Chromium's network stack verifies TLS against the Windows certificate store and honours the system proxy.
async function jiraRequest(connection, method, url, body) {
    const headers = { ...(0, jira_client_1.jiraAuthHeaders)(connection) };
    if (body !== undefined)
        headers['Content-Type'] = 'application/json';
    const init = {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        // Never follow redirects with credentials attached.
        redirect: 'error'
    };
    // Authenticates with the captured session cookie, held in an isolated per-connection session.
    const res = await (await (0, jira_browser_auth_1.jiraCookieRequestSession)(connection)).fetch(url, { ...init, credentials: 'include' });
    const bodyText = await res.text();
    return {
        status: res.status,
        ok: res.ok,
        text: bodyText,
        json: async () => bodyText ? JSON.parse(bodyText) : {}
    };
}
const APP_DIST_DIR = node_path_1.default.join(__dirname, '../../dist/work-logger/browser');
/** Dev server is only honoured for unpackaged builds so an env var cannot point the installed app at remote content. */
function devServerUrl() {
    const url = process.env['VITE_DEV_SERVER_URL'];
    return !electron_1.app.isPackaged && url ? url : null;
}
function isAppUrl(url) {
    if (!url)
        return false;
    const dev = devServerUrl();
    if (dev && url.startsWith(dev))
        return true;
    return url.startsWith((0, node_url_1.pathToFileURL)(APP_DIST_DIR).href);
}
// Every IPC call must come from the app's own page; blocks any injected or navigated-to content from using the bridge.
const registerIpcHandler = electron_1.ipcMain.handle.bind(electron_1.ipcMain);
electron_1.ipcMain.handle = (channel, listener) => registerIpcHandler(channel, (event, ...args) => {
    if (!isAppUrl(event.senderFrame?.url ?? '')) {
        writeLog('warn', 'Blocked IPC from untrusted sender', { channel, url: event.senderFrame?.url });
        throw new Error('Untrusted IPC sender');
    }
    return listener(event, ...args);
});
electron_1.app.on('web-contents-created', (_e, contents) => {
    // The Jira login window must follow redirects through Atlassian and the user's identity provider.
    const isJiraLogin = (0, jira_browser_auth_1.isJiraLoginContents)(contents);
    contents.setWindowOpenHandler(({ url }) => {
        if (isJiraLogin && (0, jira_browser_auth_1.isAllowedJiraLoginUrl)(url))
            contents.loadURL(url).catch(() => { });
        return { action: 'deny' };
    });
    const blockForeignNavigation = (event, url) => {
        if (isJiraLogin ? !(0, jira_browser_auth_1.isAllowedJiraLoginUrl)(url) : !isAppUrl(url))
            event.preventDefault();
    };
    contents.on('will-navigate', blockForeignNavigation);
    contents.on('will-redirect', blockForeignNavigation);
    contents.on('will-attach-webview', (event) => event.preventDefault());
});
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
const flex_1 = require("./flex");
const island_1 = require("./island");
const stale_1 = require("./stale");
const db_2 = require("./db");
const auth_1 = require("./auth");
const jira_browser_auth_1 = require("./jira-browser-auth");
const time_1 = require("./time");
const coverage_1 = require("./coverage");
const jira_search_1 = require("./jira-search");
const jira_client_1 = require("./jira-client");
const auto_update_1 = require("./auto-update");
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
let tray = null;
const pending = new Set(); // slot keys 'YYYY-MM-DDTHH:MM'
let tickerHandle = null; // current scheduled tick timeout
let staleCheckHandle = null;
let lastStaleNotifiedKey = null;
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
    return [c.base_url, c.token].join('|');
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
        const accountId = (0, jira_client_1.jiraUserIdFromMyself)(data);
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
function pulseIsland(kind, slot) {
    try {
        win?.webContents.send('island:pulse', { kind, slot });
    }
    catch { }
}
/**
 * The island is the only reminder channel. A visible detached window stays detached
 * (returns true so the caller opens the log dialog there); a hidden or minimized window
 * is re-docked and shown as the compact island.
 */
function surfaceReminder() {
    if (!win)
        return { detached: false };
    const visible = win.isVisible() && !win.isMinimized();
    if (windowMode === 'detached' && visible) {
        bringWindowToFront();
        return { detached: true };
    }
    if (!visible) {
        try {
            if (win.isMinimized())
                win.restore();
        }
        catch { }
        if (windowMode !== 'compact')
            applyWindowMode('compact');
        try {
            win.showInactive();
        }
        catch { }
    }
    return { detached: false };
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
            sandbox: true,
            webSecurity: true,
            // Ensure timers (interval ticker, stale checks) continue firing with accurate cadence
            // even when window is unfocused or minimized. This prevents delayed queue updates.
            backgroundThrottling: false
        }
    });
    // Update to new branded AppUserModelID (must match package.json build.appId for taskbar grouping)
    electron_1.app.setAppUserModelId('com.jyskefinans.jfloggr');
    const devUrl = devServerUrl();
    if (devUrl) {
        win.loadURL(devUrl);
        // DevTools draws a size overlay on every island resize, so only open it on request.
        if (process.env['ELECTRON_DEVTOOLS'] === '1')
            win.webContents.openDevTools({ mode: 'detach' });
    }
    else {
        win.loadFile(node_path_1.default.join(APP_DIST_DIR, 'index.html'));
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
function remindForSlot(key, kind) {
    if (!win)
        return;
    const { detached } = surfaceReminder();
    if (detached) {
        // Dialog opens even if this slot was handled before; the renderer focuses its Submit button.
        win.webContents.send('prompt:open', { slot: key, source: 'interval' });
        win.webContents.send('dialog:open-log', { slot: key, source: 'interval' });
        return;
    }
    pulseIsland(kind, key);
    if (kind === 'slot')
        win.webContents.send('prompt:open', { slot: key, source: 'island' });
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
                remindForSlot(key, 'slot');
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
            const result = (0, stale_1.computeStaleSlot)(Array.from(pending), new Date(), (0, db_1.getSettings)(), (0, time_1.getSlotMinutes)());
            if (result && result.key !== lastStaleNotifiedKey) {
                lastStaleNotifiedKey = result.key;
                remindForSlot(result.key, 'stale');
            }
        }
        catch { /* ignore */ }
    }, 60000);
}
/** True when the whole slot is logged; partial leftovers (e.g. from an older slot length) keep it pending. */
function isSlotCoveredByEntries(slotStart, entries) {
    const slotStartMinutes = slotStart.getHours() * 60 + slotStart.getMinutes();
    return (0, coverage_1.uncoveredRanges)(slotStartMinutes, slotStartMinutes + (0, time_1.getSlotMinutes)(), entries).length === 0;
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
electron_1.ipcMain.handle('stats:flex-balance', () => {
    try {
        const settings = (0, db_1.getSettings)();
        if (!settings.flex_enabled)
            return { enabled: false };
        const now = new Date();
        const balance = (0, flex_1.computeFlexBalance)((0, db_1.getAllEntries)(), settings, {
            today: (0, time_1.toLocalDateYMD)(now),
            nowMinutes: now.getHours() * 60 + now.getMinutes(),
            fromDay: settings.flex_start_date || undefined,
            excludeFlexCategory: settings.flex_exclude_andet !== false
        });
        return { enabled: true, ...balance };
    }
    catch (e) {
        logIpcFailure('stats:flex-balance', e);
        return { enabled: false };
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
    // If today was previously disabled and is now enabled, restart ticker
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
        const term = String(payload?.term ?? '').trim().slice(0, 100);
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
        const clauses = [`summary ~ "${(0, jira_client_1.escapeJqlString)(term)}*"`];
        if (/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(term)) {
            clauses.unshift(`key = "${term.toUpperCase()}"`);
        }
        const jql = `project = "${projectKey}" AND (${clauses.join(' OR ')}) ORDER BY created DESC`;
        const url = (0, jira_client_1.buildJiraSearchUrl)(connection, jql, ['key', 'summary', 'issuetype', 'assignee', 'reporter', 'customfield_10060'], 10);
        const res = await jiraRequest(connection, 'GET', url);
        if (!res.ok) {
            const expired = res.status === 401;
            return { ok: false, error: expired ? 'Jira browser-session er udløbet. Log ind igen via browser under Indstillinger.' : `Jira opslag fejlede (${res.status}).` };
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
            return { ok: false, error: `Login kunne ikke verificeres mod Jira /myself (${connection.name}). Sessionen kan være udløbet - log ind igen via browser.` };
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
electron_1.ipcMain.handle('jira:browser-login', async (_e, payload) => {
    try {
        const result = await (0, jira_browser_auth_1.loginJiraViaBrowser)(payload?.base_url, win);
        if (result.ok)
            writeLog('info', 'Jira browser login completed', { expiresAt: result.expiresAt });
        return result;
    }
    catch (e) {
        logIpcFailure('jira:browser-login', e);
        return { ok: false, error: 'Jira-login fejlede.' };
    }
});
electron_1.ipcMain.handle('jira:log-worklog', async (_e, payload) => {
    try {
        const day = String(payload?.day ?? '').trim();
        if (!day)
            return { ok: false, error: 'Dag mangler.' };
        const connection = getActiveJiraConnection();
        const missing = (0, jira_client_1.jiraConnectionMissingConfig)(connection);
        if (missing || !connection)
            return { ok: false, error: missing ?? 'Jira er ikke konfigureret.' };
        const entries = (0, db_1.getDayEntries)(day);
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
                const res = await jiraRequest(connection, 'POST', (0, jira_client_1.buildJiraWorklogUrl)(connection, key), (0, jira_client_1.buildJiraWorklogBody)(seconds, startedStr, 'Logged via JFLoggeR'));
                if (res.ok) {
                    const body = await res.json();
                    const worklogId = String(body?.id ?? '').trim();
                    results.push({ key, seconds, success: true, worklogId: worklogId || undefined });
                    if (worklogId) {
                        tracked.push({ key, worklogId, seconds, started: startedStr, logged_at: new Date().toISOString(), connection_id: connection.id });
                    }
                }
                else {
                    const body = await res.json().catch(() => res.text);
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
                    const body = await res.json().catch(() => res.text);
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
        const deleted = (0, db_1.getDayEntries)(day).find(e => e.start === start);
        const removed = (0, db_1.deleteEntry)(day, start);
        try {
            // Requeue the current-grid slots the deleted entry overlapped, even if it was logged with another slot length.
            const now = new Date();
            if (deleted && day === (0, time_1.toLocalDateYMD)(now)) {
                const from = (0, coverage_1.hmToMinute)(deleted.start);
                const to = (0, coverage_1.hmToMinute)(deleted.end);
                const gran = (0, time_1.getSlotMinutes)();
                const remaining = (0, db_1.getDayEntries)(day);
                for (const slot of (0, time_1.daySlots)(now)) {
                    const slotMin = slot.getHours() * 60 + slot.getMinutes();
                    if (slotMin + gran <= from || slotMin >= to)
                        continue;
                    if (slot.getTime() + gran * 60000 > now.getTime())
                        continue;
                    if (!isSlotCoveredByEntries(slot, remaining))
                        enqueuePending((0, time_1.slotKey)(slot), { silent: true });
                }
                try {
                    win?.webContents.send('queue:updated');
                }
                catch { }
            }
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
    const created = [];
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
            const dayCoverage = coverageByDay.get(day);
            // Only fill the parts of the slot that are still unlogged so leftovers are never overlapped.
            const slotStartMin = hh * 60 + mm;
            for (const [from, to] of (0, coverage_1.uncoveredRanges)(slotStartMin, slotStartMin + (0, time_1.getSlotMinutes)(), dayCoverage)) {
                const entry = { day, start: (0, coverage_1.minuteToHm)(from), end: (0, coverage_1.minuteToHm)(to), description, category };
                if (!groupedByDay.has(day))
                    groupedByDay.set(day, []);
                groupedByDay.get(day).push(entry);
                dayCoverage.push({ start: entry.start, end: entry.end });
                created.push({ day, start: entry.start });
            }
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
    return { ok: true, created };
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
    // The renderer needs no browser permissions.
    electron_1.session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    electron_1.session.defaultSession.setPermissionCheckHandler(() => false);
    console.log('[main] app is ready, initializing DB and window...');
    (0, db_1.initDb)();
    console.log('[main] creating main window...');
    createWindow();
    // Auto-update from GitHub releases via update.electronjs.org; failures are logged, never fatal.
    (0, auto_update_1.startAutoUpdate)({ isPackaged: electron_1.app.isPackaged, argv: process.argv, log: writeLog });
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
    console.log('[main] scheduling interval ticker...');
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