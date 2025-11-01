import { signal, effect, Injectable } from '@angular/core';

// ThemeService centralizes theme mode handling (system | light | dark)
// Applies 'dark' class to <html> and persists user choice in localStorage.
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly mode = signal<'system'|'light'|'dark'>(this.initMode());
  readonly systemPrefDark = signal<boolean>(matchMedia('(prefers-color-scheme: dark)').matches);
  readonly effective = signal<'light'|'dark'>(this.initialEffective());

  private initMode(): 'system'|'light'|'dark' {
    const stored = localStorage.getItem('themeMode');
    return stored === 'light' || stored === 'dark' ? stored : 'system';
  }

  private initialEffective(): 'light'|'dark' {
    const m = this.mode();
    const sysDark = this.systemPrefDark();
    return m === 'system' ? (sysDark ? 'dark' : 'light') : (m === 'dark' ? 'dark' : 'light');
  }

  constructor() {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', e => this.systemPrefDark.set(e.matches));

    effect(() => {
      const mode = this.mode();
      const sys = this.systemPrefDark();
      const isDark = mode === 'system' ? sys : (mode === 'dark');
      this.effective.set(isDark ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', isDark);
      // Force UA native widgets / scrollbars into correct scheme (prevents OS dark overriding light choice)
      document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
      localStorage.setItem('themeMode', mode);
    });
  }

  setMode(m: 'system'|'light'|'dark') { this.mode.set(m); }
  cycle() {
    const order: ('system'|'light'|'dark')[] = ['system','light','dark'];
    const idx = order.indexOf(this.mode());
    this.mode.set(order[(idx+1)%order.length]);
  }
}
