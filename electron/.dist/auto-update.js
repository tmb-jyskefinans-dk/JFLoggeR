"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPDATE_INTERVAL = exports.UPDATE_REPO = void 0;
exports.createUpdateLogger = createUpdateLogger;
exports.startAutoUpdate = startAutoUpdate;
// Public GitHub repo whose Squirrel releases update.electronjs.org serves.
exports.UPDATE_REPO = 'tmb-jyskefinans-dk/JFLoggeR';
exports.UPDATE_INTERVAL = '1 hour';
function errorMeta(err) {
    if (err instanceof Error)
        return { message: err.message, stack: err.stack };
    return { message: String(err) };
}
function formatArg(arg) {
    if (typeof arg === 'string')
        return arg;
    try {
        return JSON.stringify(arg);
    }
    catch {
        return String(arg);
    }
}
function createUpdateLogger(log) {
    const write = (level) => (...args) => {
        const err = args.find((a) => a instanceof Error);
        if (err) {
            log('error', 'Auto-update error', errorMeta(err));
            return;
        }
        log(level, `[update] ${args.map(formatArg).join(' ')}`);
    };
    return { log: write('info'), info: write('info'), warn: write('warn'), error: write('error') };
}
/**
 * Starts periodic update checks against update.electronjs.org. Call after the app is ready so
 * initialization runs synchronously inside this guard: an escaping error would otherwise reach the
 * process-level handler, which shuts the packaged app down. Returns whether checks were started.
 */
function startAutoUpdate({ isPackaged, argv, log, load }) {
    if (!isPackaged) {
        log('info', 'Auto-update skipped (development build)');
        return false;
    }
    // Squirrel holds a lock on the install during its lifecycle events, including the first run.
    const squirrelArg = argv.find(a => a.startsWith('--squirrel-'));
    if (squirrelArg) {
        log('info', 'Auto-update skipped during Squirrel event', { event: squirrelArg });
        return false;
    }
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const mod = load ? load() : require('update-electron-app');
        mod.updateElectronApp({
            updateSource: { type: mod.UpdateSourceType.ElectronPublicUpdateService, repo: exports.UPDATE_REPO },
            updateInterval: exports.UPDATE_INTERVAL,
            logger: createUpdateLogger(log),
            // No restart prompt: Squirrel applies a downloaded update the next time the app starts.
            notifyUser: false
        });
        log('info', 'Auto-update started', { repo: exports.UPDATE_REPO, interval: exports.UPDATE_INTERVAL });
        return true;
    }
    catch (err) {
        log('error', 'Auto-update init failed', errorMeta(err));
        return false;
    }
}
//# sourceMappingURL=auto-update.js.map