import { Component, effect, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { WindowControlsComponent } from './components/window-controls/window-controls.component';
import { IpcService } from './services/ipc.service';
import { ClockService } from './services/clock.service';
import { LogDialogComponent } from './components/log-dialog/log-dialog.component';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet, LogDialogComponent, WindowControlsComponent],
  templateUrl: "./app.component.html",
  styleUrls: []
})
export class AppComponent {
  ipc = inject(IpcService);
  clock = inject(ClockService);
  today = this.clock.today;
  dialogOpen = signal(false);
  pendingCount = signal(0);
  // Track which prompt slot has already triggered an auto-open to avoid reopening immediately after close
  handledPromptSlot = signal<string|null>(null);
  theme = inject(ThemeService);

  constructor() {
    effect(() => this.pendingCount.set(this.ipc.pendingSlots().length));

    // Open log dialog automatically when a prompt arrives (if not already open)
    effect(() => {
      const slot = this.ipc.lastPromptSlot();
      if (!slot) return;
      // Only auto-open if different from last handled slot and currently closed
      if (slot !== this.handledPromptSlot() && !this.dialogOpen()) {
        this.dialogOpen.set(true);
        this.handledPromptSlot.set(slot);
      }
    });

    // Manual tray-triggered open should always open even if same slot was previously handled.
    try {
      (window as any).workApi.onDialogOpenLog?.((slot?: string) => {
        if (!this.dialogOpen()) {
          this.dialogOpen.set(true);
        } else {
          // If already open and a different slot arrives, mark handledPromptSlot so selection logic updates.
          if (slot && slot !== this.handledPromptSlot()) this.handledPromptSlot.set(slot);
        }
      });
      (window as any).workApi.onDialogOpenLogAll?.(() => {
        // Force open dialog; selection will be handled in LogDialog ngOnInit via bulkSelectAllFlag.
        if (!this.dialogOpen()) this.dialogOpen.set(true); else {
          // If already open we can retrigger by closing & reopening or simply rely on user adjusting selection; keep open.
        }
      });
    } catch { /* ignore */ }
  }

  openDialog() { this.dialogOpen.set(true); }
}
