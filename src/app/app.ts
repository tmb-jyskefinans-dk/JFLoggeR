import { Component, effect, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { IpcService } from './services/ipc.service';
import { ClockService } from './services/clock.service';
import { LogDialogComponent } from './components/log-dialog/log-dialog.component';
import { ThemeService } from './services/theme.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet, LogDialogComponent],
  templateUrl: "./app.component.html",
  styleUrls: []
})
export class AppComponent {
  ipc = inject(IpcService);
  clock = inject(ClockService);
  today = this.clock.today;
  dialogOpen = signal(false);
  pendingCount = signal(0);
  theme = inject(ThemeService);

  constructor() {
    effect(() => this.pendingCount.set(this.ipc.pendingSlots().length));
    // Apply theme class to <html> for Tailwind dark: variants
    // pending count effect retained; theme handled by ThemeService
  }

  openDialog() { this.dialogOpen.set(true); }
  toggleTheme() { this.theme.cycle(); }
}
