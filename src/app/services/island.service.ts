import { Injectable, computed, inject, signal } from '@angular/core';
import { IpcService, PointerDragKind } from './ipc.service';

// Keep in sync with the island-morph-out animation in island.component.scss.
const COLLAPSE_ANIMATION_MS = 260;

@Injectable({ providedIn: 'root' })
export class IslandService {
  private ipc = inject(IpcService);

  readonly docked = computed(() => this.ipc.windowMode() !== 'detached');
  readonly expanded = computed(() => this.ipc.windowMode() === 'expanded');
  readonly manual = signal(false);
  readonly openedFromPrompt = signal(false);
  readonly prefill = signal(true);
  readonly collapsing = signal(false);
  readonly focusRequest = signal(0);
  private collapseTimer: ReturnType<typeof setTimeout> | null = null;

  expand(opts: { manual?: boolean; focus?: boolean; fromPrompt?: boolean; prefill?: boolean } = {}) {
    this.cancelCollapse();
    if (opts.manual !== undefined) this.manual.set(opts.manual);
    this.openedFromPrompt.set(!!opts.fromPrompt);
    this.prefill.set(opts.prefill ?? true);
    const focus = opts.focus ?? true;
    if (!this.expanded() || focus) this.ipc.setWindowMode('expanded', { focus });
  }

  collapse() {
    if (!this.expanded() || this.collapsing()) return;
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.collapsing.set(true);
    this.collapseTimer = setTimeout(() => {
      this.collapseTimer = null;
      this.collapsing.set(false);
      this.manual.set(false);
      this.openedFromPrompt.set(false);
      this.ipc.setWindowMode('compact');
    }, reduceMotion ? 0 : COLLAPSE_ANIMATION_MS);
  }

  detach() {
    this.cancelCollapse();
    this.manual.set(false);
    this.ipc.setWindowMode('detached', { focus: true });
  }

  /** Focus the mini island for a new slot so Enter repeats the previous logging; leaves an open form alone. */
  nudge() {
    if (this.expanded()) return;
    this.ipc.setWindowMode('compact', { focus: true });
    this.focusRequest.update(v => v + 1);
  }

  dock() {
    this.ipc.setWindowMode('compact');
  }

  /** Window drag/resize driven by the main process; `onTap` runs when the pointer did not move. */
  beginPointerDrag(ev: PointerEvent, kind: PointerDragKind, onTap?: () => void) {
    if (ev.button !== 0) return;
    const target = ev.currentTarget as HTMLElement | null;
    if (!target) return;
    ev.preventDefault();
    target.setPointerCapture?.(ev.pointerId);
    const startX = ev.screenX;
    const startY = ev.screenY;
    let moved = false;
    let frame = 0;
    this.ipc.pointerDrag('start', kind);

    const onMove = (e: PointerEvent) => {
      if (!moved && Math.hypot(e.screenX - startX, e.screenY - startY) < 4) return;
      moved = true;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        this.ipc.pointerDrag('move');
      });
    };
    const onEnd = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onEnd);
      target.removeEventListener('pointercancel', onEnd);
      if (frame) cancelAnimationFrame(frame);
      this.ipc.pointerDrag('end');
      if (!moved) onTap?.();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onEnd);
    target.addEventListener('pointercancel', onEnd);
  }

  private cancelCollapse() {
    if (this.collapseTimer) clearTimeout(this.collapseTimer);
    this.collapseTimer = null;
    this.collapsing.set(false);
  }
}
