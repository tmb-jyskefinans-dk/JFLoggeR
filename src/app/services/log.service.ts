import { Injectable, signal, ErrorHandler, inject } from '@angular/core';

// Lightweight logging service that forwards to Electron main (file sink) and keeps recent entries in memory for optional UI.
export interface LogEntry { ts: string; level: string; message: string; meta?: any; }

@Injectable({ providedIn: 'root' })
export class LogService {
  private recentSize = 200;
  entries = signal<LogEntry[]>([]);

  private push(entry: LogEntry) {
    const list = this.entries();
    if (list.length >= this.recentSize) list.shift();
    this.entries.set([...list, entry]);
  }

  log(level: 'debug'|'info'|'warn'|'error', message: string, meta?: any) {
    const ts = new Date().toISOString();
    const entry: LogEntry = { ts, level, message, meta };
    this.push(entry);
    try { (window as any).workApi?.logWrite?.(level, message, meta); } catch { /* ignore bridge errors */ }
    // Always echo to console for dev convenience
    if (level === 'error') console.error('[renderer]', message, meta ?? '');
    else if (level === 'warn') console.warn('[renderer]', message, meta ?? '');
    else if (level === 'debug') console.debug('[renderer]', message, meta ?? '');
    else console.log('[renderer]', message, meta ?? '');
  }

  info(message: string, meta?: any) { this.log('info', message, meta); }
  warn(message: string, meta?: any) { this.log('warn', message, meta); }
  error(message: string, meta?: any) { this.log('error', message, meta); }
  debug(message: string, meta?: any) { this.log('debug', message, meta); }
}

// Global error handler to route uncaught Angular errors into LogService.
@Injectable()
export class GlobalErrorHandler implements ErrorHandler {
  private logger = inject(LogService);
  handleError(error: any): void {
    // Angular may wrap errors; normalize
    const normalized = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
    this.logger.error('Uncaught Angular error', normalized);
  }
}

// Optional helper to install global listeners outside Angular zone (window.onerror & unhandledrejection)
export function installGlobalErrorForwarding(logger: LogService) {
  try {
    window.addEventListener('error', (ev) => {
      logger.error('Window error', { message: ev.error?.message || ev.message, stack: ev.error?.stack });
    });
    window.addEventListener('unhandledrejection', (ev) => {
      logger.error('Unhandled promise rejection', { reason: ev.reason });
    });
  } catch { /* ignore */ }
}
