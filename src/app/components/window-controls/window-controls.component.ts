import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { IpcService } from '../../services/ipc.service';
import { ThemeService } from '../../services/theme.service';
import { IslandService } from '../../services/island.service';

@Component({
  selector: 'window-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block select-none' },
  template: `
    <div class="flex items-center gap-0.5 rounded-full bg-white/70 dark:bg-slate-800/70 ring-1 ring-slate-200 dark:ring-slate-700 p-1 shadow-sm">
      <button type="button" (click)="dock()" title="Dock som ø (træk også vinduet op mod toppen)" aria-label="Dock som ø"
        class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" class="w-4 h-4" aria-hidden="true"><rect x="5" y="3" width="10" height="4" rx="2"/><path d="M10 16V10M7 13l3-3 3 3"/></svg>
      </button>
      <button type="button" (click)="toggleTheme()" [attr.aria-label]="themeAriaLabel()"
        class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition">
        <span class="text-sm" [attr.data-theme]="theme.mode()">{{ themeIcon() }}</span>
      </button>
      <button type="button" (click)="minimize()" aria-label="Minimize" class="w-8 h-8 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-600 dark:text-slate-300 transition">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5" aria-hidden="true"><path d="M5 10h10"/></svg>
      </button>
      <button type="button" (click)="toggleMax()" aria-label="Maximize / Restore" class="w-8 h-8 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full text-slate-600 dark:text-slate-300 transition">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" class="w-3.5 h-3.5" [class.opacity-70]="maximized()" aria-hidden="true"><rect x="4.5" y="4.5" width="11" height="11" rx="2.5"/></svg>
      </button>
      <button type="button" (click)="close()" aria-label="Close" class="w-8 h-8 flex items-center justify-center hover:bg-red-500 rounded-full text-red-600 dark:text-red-400 hover:text-white transition">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" class="w-3.5 h-3.5" aria-hidden="true"><path d="M6 6l8 8M14 6l-8 8"/></svg>
      </button>
    </div>
  `
})
export class WindowControlsComponent {
  private ipc = inject(IpcService);
  private island = inject(IslandService);
  theme = inject(ThemeService);
  maximized = computed(() => this.ipc.windowMaximized());

  themeIcon = computed(() => this.theme.mode() === 'dark' ? '🌙' : '☀️');
  themeAriaLabel() {
    const m = this.theme.mode();
    return m === 'dark' ? 'Aktuelt tema: mørk. Klik for at skifte til lys.' : 'Aktuelt tema: lys. Klik for at skifte til mørk.';
  }
  toggleTheme() { this.theme.toggle(); }

  dock() { this.island.dock(); }
  minimize() { this.ipc.minimizeWindow(); }
  toggleMax() { this.ipc.toggleMaximizeWindow(); }
  close() { this.ipc.closeWindow(); }
}
