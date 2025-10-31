import { Component, inject, ChangeDetectionStrategy, signal, computed, effect } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IpcService, SummaryRow } from '../../services/ipc.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { CATEGORY_GROUPS } from '../../models/categories';

@Component({
  selector: 'summary-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './summary-view.component.html',
  styleUrls: ['./summary-view.component.scss']
})
export class SummaryViewComponent  {
  private route = inject(ActivatedRoute);
  ipc = inject(IpcService);

  private paramMap = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  day = computed(() => this.paramMap()?.get('ymd') ?? '');

  loading = signal(false);

  rows = computed<SummaryRow[]>(() => this.ipc.summary());
  totalSlots = computed(() => this.rows().reduce((a, r) => a + r.slots, 0));
  totalMinutes = computed(() => this.rows().reduce((a, r) => a + r.minutes, 0));
  // Grouped totals by category
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
    return Array.from(acc.values())
      .sort((a,b)=> b.minutes - a.minutes || a.category.localeCompare(b.category));
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
      // accumulate child category inside group
      const childIdx = g.children.findIndex(c => c.category === r.category);
      if (childIdx >= 0) {
        g.children[childIdx].slots += r.slots;
        g.children[childIdx].minutes += r.minutes;
      } else {
        g.children.push({ category: r.category, slots: r.slots, minutes: r.minutes });
      }
    }
    // Sort children within each group
    for (const g of groups.values()) {
      g.children.sort((a,b)=> b.minutes - a.minutes || a.category.localeCompare(b.category));
    }
    return Array.from(groups.values()).sort((a,b)=> b.minutes - a.minutes || a.label.localeCompare(b.label));
  });

  private lastRequest = 0;

  constructor() {
    effect(() => {
      const d = this.day();
      if (!d) return;
      const req = ++this.lastRequest;
      this.loading.set(true);
      this.ipc.loadDay(d).finally(() => {
        if (req === this.lastRequest) this.loading.set(false);
      });
    });
  }
}
