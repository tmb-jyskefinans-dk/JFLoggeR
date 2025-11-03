import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { IpcService } from '../../services/ipc.service';
import { ThemeService } from '../../services/theme.service';

@Component({
  selector: 'window-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center h-9 select-none pr-2 w-full">
      <!-- Drag region -->
      <div class="flex-1 h-full -mr-2" style="-webkit-app-region: drag"></div>
      <div class="flex items-center gap-1" style="-webkit-app-region: no-drag">
        <!-- Theme toggle icon (shows current mode) -->
        <button type="button" (click)="toggleTheme()" [attr.aria-label]="themeAriaLabel()"
          class="w-10 h-9 flex items-center justify-center rounded-md hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition">
          <span class="text-base" [attr.data-theme]="theme.mode()">{{ themeIcon() }}</span>
        </button>
        <button type="button" (click)="minimize()" aria-label="Minimize" class="w-10 h-9 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-600 dark:text-slate-300"><span class="text-sm">_</span></button>
        <button type="button" (click)="toggleMax()" aria-label="Maximize / Restore" class="w-10 h-9 flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-700 rounded-md text-slate-600 dark:text-slate-300">
          <span class="text-sm" [class.opacity-70]="maximized()">▢</span>
        </button>
        <button type="button" (click)="close()" aria-label="Close" class="w-10 h-9 flex items-center justify-center hover:bg-red-500/90 rounded-md text-red-600 dark:text-red-400 hover:text-white"><span class="text-lg leading-none">×</span></button>
      </div>
    </div>
  `,
  styles: []
})
export class WindowControlsComponent {
  private ipc = inject(IpcService);
  theme = inject(ThemeService);
  maximized = computed(() => this.ipc.windowMaximized());

  themeIcon = computed(() => this.theme.mode() === 'dark' ? '🌙' : '☀️');
  themeAriaLabel() {
    const m = this.theme.mode();
    return m === 'dark' ? 'Aktuelt tema: mørk. Klik for at skifte til lys.' : 'Aktuelt tema: lys. Klik for at skifte til mørk.';
  }
  toggleTheme() { this.theme.toggle(); }

  minimize() { this.ipc.minimizeWindow(); }
  toggleMax() { this.ipc.toggleMaximizeWindow(); }
  close() { this.ipc.closeWindow(); }
}
