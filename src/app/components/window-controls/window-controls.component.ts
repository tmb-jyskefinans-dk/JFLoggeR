import { Component, ChangeDetectionStrategy, inject, computed } from '@angular/core';
import { IpcService } from '../../services/ipc.service';

@Component({
  selector: 'window-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex items-center h-9 select-none pr-2 w-full">
      <!-- Drag region -->
      <div class="flex-1 h-full -mr-2" style="-webkit-app-region: drag"></div>
      <div class="flex items-center gap-1" style="-webkit-app-region: no-drag">
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
  maximized = computed(() => this.ipc.windowMaximized());

  minimize() { this.ipc.minimizeWindow(); }
  toggleMax() { this.ipc.toggleMaximizeWindow(); }
  close() { this.ipc.closeWindow(); }
}
