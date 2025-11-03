import { signal, effect, Injectable } from '@angular/core';

// Simplified ThemeService: app controls theme explicitly (light | dark) independent of OS.
// Persists selection in localStorage and applies 'dark' class to <html>.
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<'light'|'dark'>(this.initMode());

  private initMode(): 'light'|'dark' {
    const stored = localStorage.getItem('themeMode');
    // Default to dark when no stored preference; preserve explicit light if chosen previously.
    return stored === 'light' ? 'light' : 'dark';
  }

  constructor() {
    effect(() => {
      const m = this.mode();
      const isDark = m === 'dark';
      document.documentElement.classList.toggle('dark', isDark);
  // Force color-scheme to follow explicit mode so OS dark preference doesn't keep dark form controls in light mode.
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
      localStorage.setItem('themeMode', m);
    });
  }

  private triggerTransition() {
    // Add a transient class to enable CSS transitions.
    document.documentElement.classList.add('theme-transition');
    // Remove after animation duration (~250ms)
    setTimeout(() => document.documentElement.classList.remove('theme-transition'), 300);
  }

  setMode(m: 'light'|'dark') {
    if (this.mode() === m) return;
    this.triggerTransition();
    this.mode.set(m);
  }
  toggle() {
    this.triggerTransition();
    this.mode.set(this.mode() === 'dark' ? 'light' : 'dark');
  }
}
