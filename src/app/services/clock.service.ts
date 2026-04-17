import { Injectable, OnDestroy, computed, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ClockService implements OnDestroy {
  private readonly TICK_GRACE_MS = 750;
  private now = signal(new Date());
  today = computed(() => this.toYMD(this.now()));
  // Minute value in local time, used by views for time-based recomputation
  currentTime = computed(() => this.now().getHours() * 60 + this.now().getMinutes());
  // Monotonic pulse that increments when a new minute is reached
  minuteTick = signal(0);
  private nextTickTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      this.tickNow();
      this.scheduleNextTick();
    }
  };
  private onWindowFocus = () => {
    this.tickNow();
    this.scheduleNextTick();
  };

  constructor() {
    this.tickNow();
    this.scheduleNextTick();
    window.addEventListener('focus', this.onWindowFocus);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
  }

  private tickNow() {
    const previousMinute = this.currentTime();
    const now = new Date();
    const nextMinute = now.getHours() * 60 + now.getMinutes();
    this.now.set(now);
    if (nextMinute !== previousMinute) this.minuteTick.update(v => v + 1);
  }

  private scheduleNextTick() {
    if (this.nextTickTimeoutId) clearTimeout(this.nextTickTimeoutId);
    const now = Date.now();
    const msIntoMinute = now % 60_000;
    const delayToNextMinute = (60_000 - msIntoMinute) + this.TICK_GRACE_MS;
    this.nextTickTimeoutId = setTimeout(() => {
      this.tickNow();
      this.scheduleNextTick();
    }, delayToNextMinute);
  }

  ngOnDestroy() {
    if (this.nextTickTimeoutId) clearTimeout(this.nextTickTimeoutId);
    window.removeEventListener('focus', this.onWindowFocus);
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
  }

  toYMD(d: Date) {
    const y = d.getFullYear();
    const m = `${d.getMonth()+1}`.padStart(2,'0');
    const dd = `${d.getDate()}`.padStart(2,'0');
    return `${y}-${m}-${dd}`;
  }
}
