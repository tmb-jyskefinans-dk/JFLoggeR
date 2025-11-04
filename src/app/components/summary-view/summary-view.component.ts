import { Component, inject, ChangeDetectionStrategy, signal, computed, effect, AfterViewInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IpcService, SummaryRow } from '../../services/ipc.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { CATEGORY_GROUPS } from '../../models/categories';
import { getCategoryColor } from '../../models/category-colors';
import { ExportService } from '../../services/export.service';

@Component({
  selector: 'summary-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-view.component.html',
  styleUrls: ['./summary-view.component.scss'],
  imports: [DecimalPipe],
  host: {
    '(window:keydown)': 'onKeydown($event)'
  }
})
export class SummaryViewComponent implements AfterViewInit  {
  private route = inject(ActivatedRoute);
  ipc = inject(IpcService);
  exporter = inject(ExportService);
  private router = inject(Router);

  private paramMap = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  day = computed(() => this.paramMap()?.get('ymd') ?? '');

  loading = signal(false);

  rows = computed<SummaryRow[]>(() => this.ipc.summary());
  totalSlots = computed(() => this.rows().reduce((a, r) => a + r.slots, 0));
  totalMinutes = computed(() => this.rows().reduce((a, r) => a + r.minutes, 0));
  // Grouped totals by category
  // Category totals aggregated, but ordered by CATEGORY_GROUPS definition rather than by minutes
  categoryTotals = computed(() => {
    const acc = new Map<string, { category: string; slots: number; minutes: number }>();
    for (const r of this.rows()) {
      const prev = acc.get(r.category);
      if (prev) {
        prev.slots += r.slots;
        prev.minutes += r.minutes;
      } else {
        acc.set(r.category, { category: r.category, slots: r.slots, minutes: r.minutes });
      }
    }
    // Build ordered list: iterate group items in declared order, include only present
    const ordered: { category: string; slots: number; minutes: number }[] = [];
    for (const group of CATEGORY_GROUPS) {
      for (const cat of group.items) {
        const entry = acc.get(cat);
        if (entry) ordered.push(entry);
      }
    }
    // Append any categories not in CATEGORY_GROUPS (e.g. 'Andet') in stable name order
    const extras: { category: string; slots: number; minutes: number }[] = [];
    for (const [k,v] of acc.entries()) {
      if (!CATEGORY_GROUPS.some(g => g.items.includes(k))) extras.push(v);
    }
    extras.sort((a,b) => a.category.localeCompare(b.category));
    return [...ordered, ...extras];
  });

  // Root group hierarchy: map each category to its parent label from CATEGORY_GROUPS
  rootGroupTotals = computed(() => {
    const rows = this.rows();
    // Build reverse lookup: category -> group label
    const catToGroup = new Map<string, string>();
    for (const g of CATEGORY_GROUPS) {
      for (const item of g.items) catToGroup.set(item, g.label);
    }
    const groups = new Map<string, { label: string; slots: number; minutes: number; children: { category: string; slots: number; minutes: number }[] }>();
    for (const r of rows) {
      const root = catToGroup.get(r.category) || 'Andet';
      if (!groups.has(root)) groups.set(root, { label: root, slots: 0, minutes: 0, children: [] });
      const g = groups.get(root)!;
      g.slots += r.slots;
      g.minutes += r.minutes;
      const childIdx = g.children.findIndex(c => c.category === r.category);
      if (childIdx >= 0) {
        g.children[childIdx].slots += r.slots;
        g.children[childIdx].minutes += r.minutes;
      } else {
        g.children.push({ category: r.category, slots: r.slots, minutes: r.minutes });
      }
    }
    // Sort children within each group by minutes desc for readability
    for (const g of groups.values()) {
      g.children.sort((a,b)=> b.minutes - a.minutes || a.category.localeCompare(b.category));
    }
    // Order root groups to match CATEGORY_GROUPS declaration order rather than minutes
    const orderedLabels: string[] = [];
    for (const g of CATEGORY_GROUPS) {
      if (groups.has(g.label)) orderedLabels.push(g.label);
    }
    // Append any extra groups (e.g. 'Andet') not in CATEGORY_GROUPS at the end in stable alpha order
    const extras: string[] = [];
    for (const k of groups.keys()) {
      if (!CATEGORY_GROUPS.some(g => g.label === k)) extras.push(k);
    }
    extras.sort((a,b)=> a.localeCompare(b));
    const finalOrder = [...orderedLabels, ...extras];
    return finalOrder.map(label => groups.get(label)!).filter(Boolean);
  });

  // Animation triggers
  private animResetToken = 0;
  animateBars = signal(false);
  animateDonut = signal(false);

  // Flattened category totals with color + percentages for charts
  categoryChartData = computed(() => {
    const total = this.totalMinutes();
    const data = this.categoryTotals();
    return data.map((d,i) => {
      const pct = total > 0 ? (d.minutes / total) * 100 : 0;
      // Stable color derived from category string
      return { ...d, percent: pct, color: getCategoryColor(d.category) };
    });
  });

  // Donut chart segments: cumulative offsets for stroke-dasharray
  circumference = 2 * Math.PI * 54; // for donut chart
  donutSegments = computed(() => {
    const radius = 54; // matches viewBox planned
    const circumference = this.circumference;
    let acc = 0;
    const total = this.totalMinutes();
    return this.categoryChartData().map(seg => {
      const len = total > 0 ? (seg.minutes / total) * circumference : 0;
      const s = { ...seg, length: len, offset: acc };
      acc += len;
      return s;
    });
  });

  private lastRequest = 0;
  private initialized = false;
  private toastTimeout: any = null;
  toast = signal<string | null>(null);

  // Navigation helpers
  // Format a Date as local YYYY-MM-DD without timezone shifting to UTC
  private fmtLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  private todayYmd(): string { return this.fmtLocal(new Date()); }
  isToday = computed(() => this.day() === this.todayYmd());
  prevDay = computed(() => {
    const d = this.day();
    if (!d) return '';
    const parts = d.split('-');
    if (parts.length !== 3) return '';
    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    dt.setDate(dt.getDate() - 1);
    return this.fmtLocal(dt);
  });
  nextDay = computed(() => {
    const d = this.day();
    if (!d) return '';
    const parts = d.split('-');
    if (parts.length !== 3) return '';
    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    dt.setDate(dt.getDate() + 1);
    const ymd = this.fmtLocal(dt);
    // prevent navigating into future beyond today (strict greater-than)
    return ymd > this.todayYmd() ? '' : ymd;
  });

  gotoDay(ymd: string) {
    if (!ymd) return;
    this.router.navigate(['/summary', ymd]);
  }
  gotoToday() { this.gotoDay(this.todayYmd()); }

  // Keyboard shortcuts: ArrowLeft / ArrowRight for day nav, 't' for today
  onKeydown(ev: KeyboardEvent) {
    // Ignore if modifier keys pressed (to not clash with browser/electron shortcuts)
    if (ev.altKey || ev.metaKey || ev.ctrlKey || ev.shiftKey) return;
    if (ev.key === 'ArrowLeft') {
      const prev = this.prevDay();
      if (prev) { this.gotoDay(prev); ev.preventDefault(); }
    } else if (ev.key === 'ArrowRight') {
      const next = this.nextDay();
      if (next) { this.gotoDay(next); ev.preventDefault(); }
    } else if (ev.key.toLowerCase() === 't') {
      if (!this.isToday()) { this.gotoToday(); ev.preventDefault(); }
    }
  }

  constructor() {
    effect(() => {
      const d = this.day();
      if (!d) return;
      const req = ++this.lastRequest;
      this.loading.set(true);
      // Load data; only trigger animation reset AFTER data finishes so first render shows 0-width bars before animating.
      this.ipc.loadDay(d).finally(() => {
        if (req === this.lastRequest) {
          this.loading.set(false);
          // Day change toast (skip first initialization)
          if (this.initialized) {
            this.showToast(`Dag ændret til ${d}`);
          } else {
            this.initialized = true;
          }
          this.resetAnimations();
        }
      });
    });
  }

  async exportExcel() {
    const d = this.day();
    if (!d) return;
    const result = await this.exporter.exportDaySummary(d);
    if (!result.ok) {
      console.error('[summary] export failed', result.error);
    }
  }

  private showToast(msg: string) {
    this.toast.set(msg);
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.toast.set(null);
    }, 3000);
  }

  ngAfterViewInit() {
    // No immediate start; resetAnimations schedules start after data load completes.
    // If data already loaded before view init (unlikely), the pending timeout will still fire.
  }

  private resetAnimations() {
    this.animResetToken++;
    this.animateBars.set(false);
    this.animateDonut.set(false);
    // Schedule start after microtask to allow DOM bindings update
    setTimeout(() => this.startAnimations(), 50);
  }

  private startAnimations() {
    // Avoid starting twice if already active
    if (!this.animateBars() || !this.animateDonut()) {
      this.animateBars.set(true);
      this.animateDonut.set(true);
    }
  }

  getColor(cat: string) { return getCategoryColor(cat); }
}
