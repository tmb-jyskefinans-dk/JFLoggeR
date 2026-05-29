import { Component, inject, ChangeDetectionStrategy, signal, computed, effect, AfterViewInit, OnDestroy } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { IpcService, JiraWorklogResult, SummaryRow } from '../../services/ipc.service';
import { toSignal } from '@angular/core/rxjs-interop';
import { CATEGORY_GROUPS } from '../../models/categories';
import { getCategoryColor } from '../../models/category-colors';
import { ExportService } from '../../services/export.service';
import { getJiraAfstemRows, shouldJiraAutoLogOnAfstem } from '../shared/jira-afstem.util';
import { SnackbarService } from '../../services/snackbar.service';

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
export class SummaryViewComponent implements AfterViewInit, OnDestroy  {
  private route = inject(ActivatedRoute);
  ipc = inject(IpcService);
  exporter = inject(ExportService);
  private snackbar = inject(SnackbarService);
  private router = inject(Router);

  private paramMap = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });
  day = computed(() => this.paramMap()?.get('ymd') ?? '');

  loading = signal(false);
  // Jira worklog confirmation state
  jiraConfirming = signal(false);
  jiraLogging = signal(false);
  jiraResult = signal<JiraWorklogResult | null>(null);
  jiraUnsetConfirming = signal(false);
  jiraUnsetError = signal('');
  jiraUnsetPreviewLoading = signal(false);
  jiraUnsetPreviewRows = signal<Array<{ key: string; summary: string; minutes: number; startedLabel: string }>>([]);

  rows = computed<SummaryRow[]>(() => this.ipc.summary());
  totalSlots = computed(() => this.rows().reduce((a, r) => a + r.slots, 0));
  totalMinutes = computed(() => this.rows().reduce((a, r) => a + r.minutes, 0));
  // External exported status for current day
    /** Rows eligible for Jira worklog: shared afstem rule */
    jiraWorklogRows = computed(() => getJiraAfstemRows(this.rows()));

    jiraKeyFromRow(r: SummaryRow): string {
      return r.description.match(/^([A-Z]+-\d+)/)?.[1] ?? '';
    }

    jiraSummaryFromRow(r: SummaryRow): string {
      return r.description.replace(/^[A-Z]+-\d+\s*-\s*/, '').trim();
    }

  exported = computed(() => this.ipc.dayExported().get(this.day()) ?? false);
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
  private animationTimeout: ReturnType<typeof setTimeout> | null = null;

  // Navigation helpers
  // Format a Date as local YYYY-MM-DD without timezone shifting to UTC
  private fmtLocal(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  public todayYmd(): string { return this.fmtLocal(new Date()); }
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

  onToggleExported(ev: Event) {
    const day = this.day();
    if (!day) return;
    const checked = (ev.target as HTMLInputElement).checked;
    if (!checked && this.jiraWorklogRows().length > 0) {
      void this.openJiraUnsetConfirm();
      return;
    }
    if (checked && shouldJiraAutoLogOnAfstem(this.ipc.settings())) {
      if (this.jiraWorklogRows().length === 0) {
        this.ipc.setDayExported(day, true);
        this.snackbar.show('Afstemt gennemført. Ingen tid logget til Jira.');
        return;
      }
      this.jiraConfirming.set(true);
    } else {
      this.ipc.setDayExported(day, checked);
    }
  }

  cancelJiraUnsetConfirm() {
    this.jiraUnsetConfirming.set(false);
    this.jiraUnsetError.set('');
    this.jiraUnsetPreviewLoading.set(false);
    this.jiraUnsetPreviewRows.set([]);
  }

  async confirmJiraUnset() {
    const day = this.day();
    if (!day) return;
    this.jiraUnsetError.set('');
    const res = await this.ipc.unsetAfstemtWithJiraCleanup(day);
    if (!res.ok) {
      this.jiraUnsetError.set(res.error || 'Kunne ikke fjerne Jira worklogs.');
      this.snackbar.show(`Afstem blev ikke fjernet for ${day}. ${res.error || 'Jira-oprydning fejlede.'}`);
      return;
    }
    this.jiraUnsetConfirming.set(false);
    const removed = Number(res.removed ?? 0);
    const total = Number(res.total ?? removed);
    if (total > 0) {
      this.snackbar.show(`Afstem fjernet for ${day}. Slettede ${removed}/${total} Jira worklogs.`);
    } else {
      this.snackbar.show(`Afstem fjernet for ${day}. Ingen Jira worklogs skulle slettes.`);
    }
  }

  private async openJiraUnsetConfirm() {
    const day = this.day();
    if (!day) return;
    this.jiraUnsetError.set('');
    this.jiraUnsetPreviewRows.set([]);
    this.jiraUnsetPreviewLoading.set(true);
    this.jiraUnsetConfirming.set(true);

    const resp = await this.ipc.getJiraLoggedWorklogPreview(day);
    if (!resp.ok) {
      this.jiraUnsetError.set(resp.error || 'Kunne ikke hente preview af Jira worklogs.');
      this.jiraUnsetPreviewLoading.set(false);
      return;
    }

    this.jiraUnsetPreviewRows.set(
      resp.items.map((row) => ({
        key: row.key,
        summary: (row.summary ?? '').trim(),
        minutes: Math.max(0, Math.round((row.seconds || 0) / 60)),
        startedLabel: this.formatStartedLabel(row.started)
      }))
    );
    this.jiraUnsetPreviewLoading.set(false);
  }

  private formatStartedLabel(started?: string): string {
    const value = String(started ?? '').trim();
    if (!value) return '-';
    const m = value.match(/T(\d{2}:\d{2})/);
    return m?.[1] ?? '-';
  }

  cancelJiraConfirm() {
    this.jiraConfirming.set(false);
    this.jiraResult.set(null);
  }

  async confirmJiraLog() {
    const day = this.day();
    if (!day) return;
    this.jiraLogging.set(true);
    try {
      const result = await this.ipc.logWorkToJira(day);
      this.jiraResult.set(result);
      this.jiraConfirming.set(false);
      await this.ipc.setDayExported(day, true);
    } catch {
      this.jiraResult.set({ ok: false, error: 'Uventet fejl under Jira logning.' });
      this.jiraConfirming.set(false);
    } finally {
      this.jiraLogging.set(false);
    }
  }

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
    // Display snackbar message passed via navigation state (e.g. after manual registration)
    try {
      const nav = inject(Router).getCurrentNavigation();
      const msg = nav?.extras?.state?.['snackbar'];
      if (typeof msg === 'string' && msg.trim()) {
        // Defer toast until after first data load so we don't conflict with initial day-change toast
        this.initialized = true; // prevent day-change toast overriding manual registration confirmation
        setTimeout(() => this.snackbar.show(msg.trim()), 50);
      }
    } catch { }
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
            this.snackbar.show(`Dag ændret til ${d}`);
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
      this.snackbar.show('Eksport fejlede. Prøv igen.');
      return;
    }
    this.snackbar.show(`Eksporteret: ${result.filename}`);
  }

  ngAfterViewInit() {
    // No immediate start; resetAnimations schedules start after data load completes.
    // If data already loaded before view init (unlikely), the pending timeout will still fire.
  }

  private resetAnimations() {
    this.animResetToken++;
    this.animateBars.set(false);
    this.animateDonut.set(false);
    if (this.animationTimeout) clearTimeout(this.animationTimeout);
    // Schedule start after microtask to allow DOM bindings update
    this.animationTimeout = setTimeout(() => {
      this.startAnimations();
      this.animationTimeout = null;
    }, 50);
  }

  private startAnimations() {
    // Avoid starting twice if already active
    if (!this.animateBars() || !this.animateDonut()) {
      this.animateBars.set(true);
      this.animateDonut.set(true);
    }
  }

  getColor(cat: string) { return getCategoryColor(cat); }

  ngOnDestroy() {
    if (this.animationTimeout) clearTimeout(this.animationTimeout);
    this.animationTimeout = null;
  }
}
