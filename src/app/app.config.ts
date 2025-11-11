import { ApplicationConfig, provideBrowserGlobalErrorListeners, provideZoneChangeDetection, ErrorHandler } from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { GlobalErrorHandler, LogService, installGlobalErrorForwarding } from './services/log.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes)
  ]
};

// One-time global forwarding setup (executed at config import time). This is safe because services are singletons.
// It will no-op if LogService not yet constructed; Angular constructs providers lazily after bootstrap.
setTimeout(() => {
  try {
    // Obtain the singleton via a temporary injector created post-bootstrap in main.ts; here we rely on window.ng to avoid complexity.
    // Alternatively this could move into AppComponent ngOnInit.
    // For simplicity, defer until after first tick so DI graph is ready.
    const logger: any = (window as any).ng?.getInjector?.()?.get?.(LogService);
    if (logger) installGlobalErrorForwarding(logger);
  } catch { /* ignore */ }
}, 0);
