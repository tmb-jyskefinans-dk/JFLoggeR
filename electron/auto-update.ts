import type { ILogger, IUpdateElectronAppOptions, UpdateSourceType } from 'update-electron-app';

// Public GitHub repo whose Squirrel releases update.electronjs.org serves.
export const UPDATE_REPO = 'tmb-jyskefinans-dk/JFLoggeR';
export const UPDATE_INTERVAL = '1 hour';

export type UpdateLogLevel = 'info' | 'warn' | 'error';
export type UpdateLog = (level: UpdateLogLevel, message: string, meta?: unknown) => void;

export interface UpdateElectronAppModule {
  updateElectronApp: (opts: IUpdateElectronAppOptions) => unknown;
  UpdateSourceType: typeof UpdateSourceType;
}

export interface StartAutoUpdateOptions {
  isPackaged: boolean;
  argv: readonly string[];
  log: UpdateLog;
  load?: () => UpdateElectronAppModule;
}

function errorMeta(err: unknown): { message: string; stack?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack };
  return { message: String(err) };
}

function formatArg(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

export function createUpdateLogger(log: UpdateLog): ILogger {
  const write = (level: UpdateLogLevel) => (...args: unknown[]) => {
    const err = args.find((a): a is Error => a instanceof Error);
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
export function startAutoUpdate({ isPackaged, argv, log, load }: StartAutoUpdateOptions): boolean {
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
    const mod = load ? load() : (require('update-electron-app') as UpdateElectronAppModule);
    mod.updateElectronApp({
      updateSource: { type: mod.UpdateSourceType.ElectronPublicUpdateService, repo: UPDATE_REPO },
      updateInterval: UPDATE_INTERVAL,
      logger: createUpdateLogger(log),
      // No restart prompt: Squirrel applies a downloaded update the next time the app starts.
      notifyUser: false
    });
    log('info', 'Auto-update started', { repo: UPDATE_REPO, interval: UPDATE_INTERVAL });
    return true;
  } catch (err) {
    log('error', 'Auto-update init failed', errorMeta(err));
    return false;
  }
}
