import { Component, effect, inject, signal, ChangeDetectionStrategy, OnDestroy } from '@angular/core';
import { RouterLink, RouterOutlet, Router } from '@angular/router';
import { WindowControlsComponent } from './components/window-controls/window-controls.component';
import { IpcService } from './services/ipc.service';
import { ClockService } from './services/clock.service';
import { LogDialogComponent } from './components/log-dialog/log-dialog.component';
import { ThemeService } from './services/theme.service';
import { SnackbarService } from './services/snackbar.service';

@Component({
  selector: 'app-root',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, RouterOutlet, LogDialogComponent, WindowControlsComponent],
  templateUrl: "./app.component.html",
  styleUrls: []
})
export class AppComponent implements OnDestroy {
  ipc = inject(IpcService);
  clock = inject(ClockService);
  router = inject(Router);
  today = this.clock.today;
  dialogOpen = signal(false);
  manualDialogOpen = signal(false);
  menuOpen = signal(false);
  manualDialogDate = signal<string>('');
  pendingCount = signal(0);
  dialogOpenedFromNotification = signal(false);
  // Track which prompt slot has already triggered an auto-open to avoid reopening immediately after close
  handledPromptSlot = signal<string|null>(null);
  theme = inject(ThemeService);
  snackbar = inject(SnackbarService);
  private removeDialogOpenLogListener?: () => void;
  private removeDialogOpenLogAllListener?: () => void;

  private onOpenLogDialog = (e: Event) => {
    const ce = e as CustomEvent<{ slot?: string }>;
    const slot = ce?.detail?.slot;
    this.dialogOpenedFromNotification.set(false);
    if (!this.dialogOpen()) this.dialogOpen.set(true); else {
      if (slot && slot !== this.handledPromptSlot()) this.handledPromptSlot.set(slot);
    }
    if (slot && slot !== this.handledPromptSlot()) this.handledPromptSlot.set(slot);
  };

  private onKeydown = (ev: KeyboardEvent) => {
    // Ignore if focused inside editable elements
    const target = ev.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;
    if (!ev.altKey) return;
    const key = ev.key.toLowerCase();
    switch (key) {
      case 'm': // manual log popup
        ev.preventDefault();
        this.openManualWithDate();
        break;
      case 'l': // log now (open pending slots dialog)
        ev.preventDefault();
        this.openDialog();
        this.closeMenu();
        break;
      case 's': // summary view for current day
        ev.preventDefault();
        this.router.navigate(['/summary', this.getCurrentDay()]);
        break;
      case 't': // today view
        ev.preventDefault();
        this.router.navigate(['/today']);
        break;
      case 'i': // settings (Indstillinger)
        ev.preventDefault();
        this.router.navigate(['/settings']);
        break;
    }
  };

  private onPointerdown = (ev: PointerEvent) => {
    if (!this.menuOpen()) return;
    const menuRoot = document.querySelector('[data-menu-root]');
    if (menuRoot && !menuRoot.contains(ev.target as Node)) {
      this.closeMenu();
    }
  };

  constructor() {
    effect(() => this.pendingCount.set(this.ipc.pendingSlots().length));
    effect(() => {
      this.clock.minuteTick();
      this.ipc.loadPending();
    });

    // Open log dialog automatically when a prompt arrives (if not already open)
    effect(() => {
      const slot = this.ipc.lastPromptSlot();
      if (!slot) return;
      const source = this.ipc.lastPromptSource();
      const shouldMinimizeAfterSubmit = source === 'notification' || source === 'auto-focus';
      // Only auto-open if different from last handled slot and currently closed
      if (slot !== this.handledPromptSlot() && !this.dialogOpen()) {
        this.dialogOpenedFromNotification.set(shouldMinimizeAfterSubmit);
        this.dialogOpen.set(true);
        this.handledPromptSlot.set(slot);
      }
    });

    // Manual tray-triggered open should always open even if same slot was previously handled.
    try {
      const disposeDialogOpenLog = (window as any).workApi.onDialogOpenLog?.((d?: { slot?: string; source?: string }) => {
        const slot = d?.slot;
        this.dialogOpenedFromNotification.set(d?.source === 'notification' || d?.source === 'auto-focus');
        if (!this.dialogOpen()) {
          this.dialogOpen.set(true);
        } else {
          // If already open and a different slot arrives, mark handledPromptSlot so selection logic updates.
          if (slot && slot !== this.handledPromptSlot()) this.handledPromptSlot.set(slot);
        }
      });
      if (typeof disposeDialogOpenLog === 'function') {
        this.removeDialogOpenLogListener = disposeDialogOpenLog;
      }
      const disposeDialogOpenLogAll = (window as any).workApi.onDialogOpenLogAll?.(() => {
        // Force open dialog; selection will be handled in LogDialog ngOnInit via bulkSelectAllFlag.
        if (!this.dialogOpen()) this.dialogOpen.set(true); else {
          // If already open we can retrigger by closing & reopening or simply rely on user adjusting selection; keep open.
        }
      });
      if (typeof disposeDialogOpenLogAll === 'function') {
        this.removeDialogOpenLogAllListener = disposeDialogOpenLogAll;
      }
    } catch { /* ignore */ }

    // Listen for custom event dispatched by DayViewComponent to open dialog for a missing slot
    window.addEventListener('open-log-dialog', this.onOpenLogDialog);

    // Keyboard shortcut Alt+M opens manual log dialog prefilled with viewed day
    window.addEventListener('keydown', this.onKeydown);

    // Outside click closes the split-button dropdown menu
    window.addEventListener('pointerdown', this.onPointerdown);
  }

  openDialog() {
    this.dialogOpenedFromNotification.set(false);
    this.dialogOpen.set(true);
  }
  openManualDialog() { this.manualDialogOpen.set(true); }
  closeDialog() {
    this.dialogOpen.set(false);
    this.dialogOpenedFromNotification.set(false);
    // Keep the current prompt slot marked as handled so the auto-open effect
    // does not immediately reopen the dialog while that slot is still pending.
    const currentPrompt = this.ipc.lastPromptSlot();
    if (currentPrompt) this.handledPromptSlot.set(currentPrompt);
  }
  closeManualDialog() { this.manualDialogOpen.set(false); }
  toggleMenu() { this.menuOpen.update(v => !v); }
  closeMenu() { this.menuOpen.set(false); }
  private getCurrentDay(): string {
    const url = this.router.url || '';
    const m = url.match(/\/(day|summary)\/(\d{4}-\d{2}-\d{2})/);
    return m ? m[2] : this.clock.today();
  }
  openManualWithDate() {
    this.manualDialogDate.set(this.getCurrentDay());
    this.openManualDialog();
    this.closeMenu();
  }

  ngOnDestroy() {
    window.removeEventListener('open-log-dialog', this.onOpenLogDialog);
    window.removeEventListener('keydown', this.onKeydown);
    window.removeEventListener('pointerdown', this.onPointerdown);
    this.removeDialogOpenLogListener?.();
    this.removeDialogOpenLogAllListener?.();
  }
}
