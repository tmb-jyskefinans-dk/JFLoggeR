import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { IpcService } from '../../services/ipc.service';
import { ClockService } from '../../services/clock.service';
import { IslandService } from '../../services/island.service';
import { SnackbarService } from '../../services/snackbar.service';
import { LogDialogComponent } from '../log-dialog/log-dialog.component';
import {
  IslandEntryLike,
  currentSlotRange,
  formatDuration,
  isInWorkTime,
  lastLoggedEntry,
  loggedMinutes,
  newestPendingSlot,
  nextLogSlot,
  plannedWorkMinutes,
  progressRatio
} from './island-status.util';
import { effectiveSlotMinutes } from '../../models/work-schedule';

const RING_RADIUS = 15.5;
const PANEL_WINDOW_PADDING = 2;
const UNDO_WINDOW_MS = 6000;
// Keep in sync with the pill transition duration in island.component.scss.
const MORPH_MS = 380;

@Component({
  selector: 'island',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LogDialogComponent],
  templateUrl: './island.component.html',
  styleUrls: ['./island.component.scss'],
  host: { class: 'block h-screen w-screen overflow-hidden select-none' }
})
export class IslandComponent implements OnDestroy {
  ipc = inject(IpcService);
  clock = inject(ClockService);
  island = inject(IslandService);
  snackbar = inject(SnackbarService);

  readonly ringCircumference = 2 * Math.PI * RING_RADIUS;
  readonly ringRadius = RING_RADIUS;
  readonly undoWindowMs = UNDO_WINDOW_MS;

  private settings = computed(() => this.ipc.settings() ?? {});
  slot = computed(() => {
    this.clock.currentTime();
    return currentSlotRange(new Date(), effectiveSlotMinutes(this.settings()));
  });
  inWorkHours = computed(() => {
    this.clock.currentTime();
    return isInWorkTime(new Date(), this.settings());
  });
  private todayEntries = computed<IslandEntryLike[]>(() => {
    const today = this.clock.today();
    return (this.ipc.dayEntries() as Array<IslandEntryLike & { day?: string }>).filter(e => e.day === today);
  });
  loggedLabel = computed(() => formatDuration(loggedMinutes(this.todayEntries())));
  progress = computed(() => {
    this.clock.today();
    return progressRatio(loggedMinutes(this.todayEntries()), plannedWorkMinutes(new Date(), this.settings()));
  });
  progressPct = computed(() => Math.round(this.progress() * 100));
  ringOffset = computed(() => this.ringCircumference * (1 - this.progress()));
  pendingCount = computed(() => this.ipc.pendingSlots().length);
  private holdCompact = signal(false);
  idle = computed(() => this.pendingCount() === 0 && !this.holdCompact());
  nextLog = computed(() => {
    this.clock.currentTime();
    return nextLogSlot(new Date(), this.settings());
  });
  nextLogTitle = computed(() => {
    const next = this.nextLog();
    return next ? `Næste interval logges kl. ${next.time} (om ${formatDuration(next.minutesUntil)})` : 'Ingen flere intervaller i dag';
  });

  lastEntry = computed<Pick<IslandEntryLike, 'description' | 'category'> | null>(() => {
    const fromToday = lastLoggedEntry(this.todayEntries());
    if (fromToday) return fromToday;
    const recent = this.ipc.recent()?.[0];
    return recent?.description && recent?.category ? { description: recent.description, category: recent.category } : null;
  });
  sameAgainSlot = computed(() => newestPendingSlot(this.ipc.pendingSlots()));
  canSameAgain = computed(() => {
    const slot = this.sameAgainSlot();
    if (!slot || !this.lastEntry() || this.busy()) return false;
    return !this.ipc.dayExported().get(slot.split('T')[0]);
  });
  sameAgainTitle = computed(() => {
    const slot = this.sameAgainSlot();
    const entry = this.lastEntry();
    if (!slot || !entry) return '';
    return `Log ${slot.split('T')[1]} som "${entry.description}" (${entry.category})`;
  });

  busy = signal(false);
  justLogged = signal<{ day: string; start: string } | null>(null);
  pulseKind = signal<'slot' | 'stale' | 'digest' | null>(null);
  private pulseTimer: ReturnType<typeof setTimeout> | null = null;
  private undoTimer: ReturnType<typeof setTimeout> | null = null;
  private panelContent = viewChild<ElementRef<HTMLElement>>('panelContent');
  private sameAgainBtn = viewChild<ElementRef<HTMLButtonElement>>('sameAgainBtn');
  private otherBtn = viewChild<ElementRef<HTMLButtonElement>>('otherBtn');
  private focusTimer: ReturnType<typeof setTimeout> | null = null;
  private sizeTimer: ReturnType<typeof setTimeout> | null = null;
  morphing = signal(false);

  constructor() {
    // Grow the window before the pill morphs up; shrink it only after the pill has morphed down.
    effect(() => {
      const idle = this.idle();
      untracked(() => {
        if (this.sizeTimer) clearTimeout(this.sizeTimer);
        this.sizeTimer = null;
        if (!idle) { this.ipc.setIslandCompactIdle(false); return; }
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        this.sizeTimer = setTimeout(() => this.ipc.setIslandCompactIdle(true), reduceMotion ? 0 : MORPH_MS);
      });
    });

    // Pending slots load asynchronously after a nudge, so retry until "same again" is rendered.
    effect(() => {
      if (!this.island.focusRequest()) return;
      untracked(() => this.focusNudgeTarget());
    });

    effect(() => {
      const today = this.clock.today();
      this.ipc.pendingSlots();
      untracked(() => this.ipc.loadDay(today));
    });

    effect(() => {
      const pulse = this.ipc.islandPulse();
      if (!pulse) return;
      untracked(() => {
        this.pulseKind.set(pulse.kind);
        if (this.pulseTimer) clearTimeout(this.pulseTimer);
        this.pulseTimer = setTimeout(() => this.pulseKind.set(null), 3600);
      });
    });

    // Grow/shrink the docked window to fit the expanded panel content.
    effect((onCleanup) => {
      const el = this.panelContent()?.nativeElement;
      if (!el) return;
      let lastHeight = 0;
      const observer = new ResizeObserver(() => {
        const height = el.offsetHeight + PANEL_WINDOW_PADDING;
        if (Math.abs(height - lastHeight) < 2) return;
        lastHeight = height;
        this.ipc.resizeIsland(height);
      });
      observer.observe(el);
      onCleanup(() => observer.disconnect());
    });
  }

  onPillPointerDown(ev: PointerEvent) {
    this.island.beginPointerDrag(ev, 'move', () => this.expand());
  }

  onHeaderPointerDown(ev: PointerEvent) {
    this.island.beginPointerDrag(ev, 'move');
  }

  expand() {
    this.island.expand({ manual: this.pendingCount() === 0, focus: true });
  }

  logOther() {
    this.island.expand({ manual: false, focus: true, prefill: false });
  }

  private focusNudgeTarget(attempt = 0) {
    if (this.focusTimer) clearTimeout(this.focusTimer);
    const sameAgain = this.sameAgainBtn()?.nativeElement;
    if (sameAgain || attempt >= 10) {
      (sameAgain ?? this.otherBtn()?.nativeElement)?.focus();
      this.focusTimer = null;
      return;
    }
    this.focusTimer = setTimeout(() => this.focusNudgeTarget(attempt + 1), 60);
  }

  toggleManual() {
    this.island.manual.update(v => !v);
  }

  async sameAgain() {
    const slot = this.sameAgainSlot();
    const entry = this.lastEntry();
    if (!slot || !entry || !this.canSameAgain()) return;
    this.busy.set(true);
    // Hold before submitting so the emptied queue never shrinks the island mid-undo.
    this.holdCompact.set(true);
    try {
      await this.ipc.submitPending([slot], entry.description, entry.category);
      const [day, start] = slot.split('T');
      this.ipc.loadDay(day);
      this.justLogged.set({ day, start });
      if (this.undoTimer) clearTimeout(this.undoTimer);
      this.undoTimer = setTimeout(() => {
        this.justLogged.set(null);
        this.holdCompact.set(false);
      }, UNDO_WINDOW_MS);
    } catch {
      this.holdCompact.set(false);
      this.snackbar.show('Kunne ikke logge intervallet.');
    } finally {
      this.busy.set(false);
    }
  }

  async undo() {
    const logged = this.justLogged();
    if (!logged) return;
    this.justLogged.set(null);
    if (this.undoTimer) clearTimeout(this.undoTimer);
    this.holdCompact.set(false);
    try {
      await this.ipc.deleteEntry(logged.day, logged.start);
    } catch {
      this.snackbar.show('Fortryd fejlede.');
    }
  }

  onMorphStart(ev: AnimationEvent) {
    if (ev.animationName.includes('island-panel-')) this.morphing.set(true);
  }

  onMorphEnd(ev: AnimationEvent) {
    if (ev.animationName.includes('island-panel-')) this.morphing.set(false);
  }

  ngOnDestroy() {
    if (this.sizeTimer) clearTimeout(this.sizeTimer);
    if (this.focusTimer) clearTimeout(this.focusTimer);
    if (this.pulseTimer) clearTimeout(this.pulseTimer);
    if (this.undoTimer) clearTimeout(this.undoTimer);
  }
}
