import { Component, inject, ChangeDetectionStrategy, signal, computed, effect, untracked, OnDestroy } from '@angular/core';
import { getCategoryColor } from '../../models/category-colors';
import { CATEGORY_GROUPS } from '../../models/categories';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IpcService } from '../../services/ipc.service';
import { ClockService } from '../../services/clock.service';
import { getActiveJiraConnection, getJiraAfstemRows, shouldJiraAutoLogOnAfstem } from '../shared/jira-afstem.util';
import { SnackbarService } from '../../services/snackbar.service';
import {
  categoryTotals,
  formatDuration,
  groupDayBlocks,
  missingRowsForDay,
  plannedMinutesForDay,
  isoWeek,
  shiftYmd,
  splitJiraKey,
  type DayBlock,
  type DayRowLike
} from './day-blocks.util';
import {
  effectiveSlotMinutes,
  type WorkScheduleSettingsLike
} from '../../models/work-schedule';

type DayRow = DayBlock<DayRowLike> & {
  jiraKey: string;
  text: string;
  color: string;
  durationLabel: string;
};

@Component({
  selector: 'day-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './day-view.component.html',
  styleUrls: ['./day-view.component.scss']
})
export class DayViewComponent implements OnDestroy {
  route = inject(ActivatedRoute);
  ipc = inject(IpcService);
  clock = inject(ClockService);
  snackbar = inject(SnackbarService);
  routeParamMap = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });

  // Source signals
  day = signal<string>('');
  isTodayView = signal(false);
  confirmDeleteStart = signal<string | null>(null);
  private confirmDeleteTimer: ReturnType<typeof setTimeout> | null = null;
  archiveJiraConfirmOpen = signal(false);
  archiveJiraConfirmDay = signal('');
  archiveJiraConfirmRows = signal<Array<{ description: string; category: string; minutes: number }>>([]);
  archiveJiraConfirmLoading = signal(false);
  archiveJiraConfirmSubmitting = signal(false);
  archiveJiraConfirmError = signal('');
  archiveJiraUnsetConfirmOpen = signal(false);
  archiveJiraUnsetConfirmDay = signal('');
  archiveJiraUnsetConfirmError = signal('');
  archiveJiraUnsetPreviewLoading = signal(false);
  archiveJiraUnsetPreviewRows = signal<Array<{ key: string; summary: string; minutes: number; startedLabel: string }>>([]);
  jiraConnectionName = computed(() => String(getActiveJiraConnection(this.ipc.settings())?.name ?? ''));

  archiveJiraKey(description: string): string {
    return String(description ?? '').match(/^([A-Z]+-\d+)/)?.[1] ?? '';
  }

  archiveJiraSummary(description: string): string {
    return String(description ?? '').replace(/^[A-Z]+-\d+\s*-\s*/, '').trim();
  }

  // Category edit state
  editingKey = signal<string|null>(null);
  menuX = signal<number>(0);
  menuY = signal<number>(0);
  menuFlip = signal<boolean>(false);
  allCategories = computed(() => {
    // Collect from declared groups plus any ad-hoc categories present in entries and the default 'Import'
    const fromGroups: string[] = CATEGORY_GROUPS.flatMap(g => g.items);
    const present = new Set(this.entries().map(e => e.category).filter(c => !!c));
    const extras: string[] = [];
    for (const c of present) if (!fromGroups.includes(c)) extras.push(c);
    if (!present.has('Import')) extras.push('Import');
    return [...fromGroups, ...extras].filter((v,i,arr)=> arr.indexOf(v)===i);
  });

  // Grouped categories for selector (root groups + Øvrige for ad-hoc/import)
  menuCategoryGroups = computed(() => {
    const present = new Set(this.entries().map(e => e.category).filter(Boolean));
    const groups = CATEGORY_GROUPS.map(g => ({ label: g.label, items: [...g.items] }));
    const known = new Set(CATEGORY_GROUPS.flatMap(g => g.items));
    const extras: string[] = [];
    for (const cat of present) if (!known.has(cat)) extras.push(cat);
    if (!known.has('Import')) extras.push('Import');
    const dedupExtras = extras.filter((v,i,a)=> a.indexOf(v)===i).sort((a,b)=> a.localeCompare(b));
    if (dedupExtras.length) groups.push({ label: 'Øvrige', items: dedupExtras });
    return groups;
  });

  beginEdit(block: DayRow, ev?: Event) {
    if (!block || block.kind !== 'entry' || this.dayLocked()) return;
    this.editingKey.set(block.start);
    // Compute viewport position for dropdown to avoid scroll container clipping
    if (ev && ev.target) {
      const el = (ev.target as HTMLElement).closest('button') || (ev.target as HTMLElement);
      if (el) {
        const rect = el.getBoundingClientRect();
        // Position below cell; adjust if near bottom later if needed
        const margin = 8; // space between cell and menu
        const menuHeightEstimate = 260; // rough average height; will adjust flip if insufficient space
        const viewportH = window.innerHeight || document.documentElement.clientHeight || 800;
        const wouldOverflow = rect.bottom + margin + menuHeightEstimate > viewportH;
        this.menuFlip.set(wouldOverflow);
        this.menuX.set(rect.left);
        if (wouldOverflow) {
          // Render above: position top at (rect.top - menuHeightEstimate) but keep within viewport
          let y = rect.top - margin - menuHeightEstimate;
          if (y < 0) y = 4; // clamp
          this.menuY.set(y);
        } else {
          this.menuY.set(rect.bottom + margin);
        }
      }
    }
  }
  cancelEdit() { this.editingKey.set(null); }
  isEditing(block: DayRow) { return !!block && block.kind === 'entry' && this.editingKey() === block.start; }
  async applyCategory(block: DayRow, cat: string) {
    if (!block || block.kind !== 'entry' || !cat) return;
    const day = this.day();
    const entries = block.rows.map(r => ({ day, start: r.start, end: r.end, description: r.description, category: cat }));
    this.editingKey.set(null);
    try { await window.workApi.saveEntries(entries); } catch { this.snackbar.show('Kunne ikke ændre kategori.'); }
    this.ipc.loadDay(day);
    this.ipc.refreshDays();
  }

  // Derived / mirrored signals from service
  entries = computed(() => this.ipc.dayEntries());
  days = computed(() => this.ipc.days());
  settings = computed(() => this.ipc.settings());
  pendingSlotsForDay = computed(() => {
    const day = this.day();
    if (!day) return [] as string[];
    const prefix = `${day}T`;
    return this.ipc.pendingSlots().filter(s => s.startsWith(prefix));
  });

  /**
   * Logged entries plus missing ranges (exact unlogged minutes of each scheduled slot), sorted by start.
   * Depends on clock.currentTime() to auto-update missing blocks as time passes.
   */
  rows = computed<DayRowLike[]>(() => {
    const currentMinutes = this.clock.currentTime();
    const list = this.entries() as DayRowLike[];
    const s = this.settings();
    const day = this.day();
    if (!day || !s) return list;
    const nowLimit = day === this.clock.today() ? currentMinutes : Infinity;
    // Pending slots appear immediately, even before the minute ticker catches up.
    const pendingStarts = new Set(this.pendingSlotsForDay().map(k => k.slice(11, 16)));
    const missing = missingRowsForDay(list, s, day, nowLimit, pendingStarts);
    return [...list, ...missing].sort((a, b) => a.start.localeCompare(b.start));
  });

  missingSlotKeys = computed(() => {
    const day = this.day();
    if (!day) return [] as string[];
    const starts = new Set(this.rows().filter(r => r.missing && r.slotStart).map(r => r.slotStart!));
    return [...starts].map(start => `${day}T${start}`);
  });

  blocks = computed<DayRow[]>(() => groupDayBlocks(this.rows())
    .map(b => {
      const { key, text } = splitJiraKey(b.description);
      return { ...b, jiraKey: key, text, color: b.kind === 'entry' ? getCategoryColor(b.category) : '', durationLabel: formatDuration(b.minutes) };
    }));
  private entryBlocks = computed(() => this.blocks().filter(b => b.kind === 'entry'));
  loggedMinutesDay = computed(() => this.entryBlocks().reduce((sum, b) => sum + b.minutes, 0));
  plannedMinutesDay = computed(() => plannedMinutesForDay(this.settings(), this.day()));
  missingMinutesDay = computed(() => this.blocks().filter(b => b.kind === 'missing').reduce((sum, b) => sum + b.minutes, 0));
  loggedLabel = computed(() => formatDuration(this.loggedMinutesDay()));
  plannedLabel = computed(() => formatDuration(this.plannedMinutesDay()));
  missingLabel = computed(() => formatDuration(this.missingMinutesDay()));
  progressPct = computed(() => {
    const planned = this.plannedMinutesDay();
    return planned > 0 ? Math.round((this.loggedMinutesDay() / planned) * 100) : 0;
  });
  categoryBreakdown = computed(() => {
    const totals = categoryTotals(this.entries());
    const scale = Math.max(this.plannedMinutesDay(), totals.reduce((sum, c) => sum + c.minutes, 0));
    return totals.map(c => ({
      ...c,
      color: getCategoryColor(c.category),
      label: formatDuration(c.minutes),
      pct: scale > 0 ? (c.minutes / scale) * 100 : 0
    }));
  });
  breakdownAria = computed(() => {
    const parts = this.categoryBreakdown().map(c => `${c.category} ${c.label}`);
    return parts.length ? `Fordeling: ${parts.join(', ')}` : 'Ingen registreringer';
  });

  flexEnabled = computed(() => this.ipc.flexBalance().enabled);
  flexBalanceMinutes = computed(() => this.ipc.flexBalance().balanceMinutes ?? 0);
  flexDay = computed(() => this.ipc.flexBalance().days?.[this.day()] ?? null);
  flexTitle = computed(() => {
    const flex = this.ipc.flexBalance();
    const from = flex.fromDay ? ` siden ${flex.fromDay}` : '';
    return `Flex saldo${from}: arbejdet tid minus planlagt tid på dage med registreringer.`;
  });
  readonly duration = formatDuration;
  signedDuration(minutes: number): string {
    if (!minutes) return '±0m';
    return `${minutes > 0 ? '+' : '−'}${formatDuration(Math.abs(minutes))}`;
  }

  isToday = computed(() => this.day() === this.clock.today());
  prevDay = computed(() => this.day() ? shiftYmd(this.day(), -1) : '');
  nextDay = computed(() => this.day() ? shiftYmd(this.day(), 1) : '');
  canGoNext = computed(() => !!this.day() && this.day() < this.clock.today());
  dayLink(ymd: string): unknown[] {
    return ymd === this.clock.today() ? ['/today'] : ['/day', ymd];
  }
  dayHeading = computed(() => {
    const ymd = this.day();
    if (!ymd) return '';
    if (ymd === this.clock.today()) return 'I dag';
    if (ymd === shiftYmd(this.clock.today(), -1)) return 'I går';
    const [y, m, d] = ymd.split('-').map(Number);
    const name = new Date(y, (m || 1) - 1, d || 1).toLocaleDateString('da-DK', { weekday: 'long' });
    return name.charAt(0).toUpperCase() + name.slice(1);
  });
  dayLongDate = computed(() => {
    const ymd = this.day();
    if (!ymd) return '';
    const [y, m, d] = ymd.split('-').map(Number);
    const date = new Date(y, (m || 1) - 1, d || 1);
    const long = date.toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
    const isNamedDay = ymd === this.clock.today() || ymd === shiftYmd(this.clock.today(), -1);
    return isNamedDay ? `${date.toLocaleDateString('da-DK', { weekday: 'long' })} ${long}` : long;
  });

  // Ordered categories using same logic as summary (group declaration order then extras)
  orderedCategories = computed(() => {
    const present = new Set(this.entries().map(e => e.category));
    const ordered: string[] = [];
    for (const grp of CATEGORY_GROUPS) {
      for (const cat of grp.items) if (present.has(cat)) ordered.push(cat);
    }
    // extras (e.g. 'Andet' or unmatched) appended alphabetically
    const extras: string[] = [];
    for (const cat of present) {
      if (!ordered.includes(cat)) extras.push(cat);
    }
    extras.sort((a,b)=> a.localeCompare(b));
    return [...ordered, ...extras];
  });

  // Use hashing-based getCategoryColor like summary (no position indexing) for full consistency
  getColor(cat: string): string { return getCategoryColor(cat); }

  private weekdayNames = ['Søn','Man','Tir','Ons','Tor','Fre','Lør'];
  dayLocked = computed(() => {
    const day = this.day();
    return !!day && !!this.ipc.dayExported().get(day);
  });
  daysWithWeekday = computed(() => {
    const slotMinutes = effectiveSlotMinutes(this.settings());
    const flexDays = this.ipc.flexBalance().days ?? {};
    return this.days().map(d => {
      const [y,m,dd] = d.day.split('-').map(Number);
      const dt = new Date(y,(m||1)-1,dd||1);
      const exported = this.ipc.dayExported().get(d.day) || false;
      const flexDelta = flexDays[d.day]?.deltaMinutes ?? null;
      return { ...d, weekday: this.weekdayNames[dt.getDay()], exported, durationLabel: formatDuration(d.slots * slotMinutes), flexDelta };
    });
  });

  currentMonthKey = computed(() => this.clock.today().slice(0, 7));
  currentYearKey = computed(() => this.clock.today().slice(0, 4));
  expandedMonths = signal<string[]>([]);
  expandedYears = signal<string[]>([]);
  private monthAccordionInitialized = signal(false);
  private yearAccordionInitialized = signal(false);

  daysByMonth = computed(() => {
    const sorted = [...this.daysWithWeekday()].sort((a, b) => b.day.localeCompare(a.day));
    type Day = (typeof sorted)[number];
    type Week = { key: string; label: string; days: Day[]; flexMinutes: number };
    const groups = new Map<string, { key: string; label: string; days: Day[]; weeks: Week[]; flexMinutes: number }>();
    for (const d of sorted) {
      const key = d.day.slice(0, 7); // YYYY-MM
      if (!groups.has(key)) {
        const [y, m] = key.split('-').map(Number);
        const label = new Date(y, (m || 1) - 1, 1).toLocaleDateString('da-DK', {
          month: 'long',
          year: 'numeric'
        });
        groups.set(key, { key, label, days: [], weeks: [], flexMinutes: 0 });
      }
      const group = groups.get(key)!;
      group.days.push(d);
      group.flexMinutes += d.flexDelta ?? 0;
      const { year, week } = isoWeek(d.day);
      const weekKey = `${year}-W${week}`;
      let target = group.weeks[group.weeks.length - 1];
      if (target?.key !== weekKey) {
        target = { key: weekKey, label: `Uge ${week}`, days: [], flexMinutes: 0 };
        group.weeks.push(target);
      }
      target.days.push(d);
      target.flexMinutes += d.flexDelta ?? 0;
    }
    return Array.from(groups.values());
  });

  daysByYear = computed(() => {
    const months = this.daysByMonth();
    const groups = new Map<string, { key: string; label: string; isPreviousYear: boolean; months: typeof months; flexMinutes: number }>();
    const currentYear = this.currentYearKey();
    for (const month of months) {
      const yearKey = month.key.slice(0, 4);
      if (!groups.has(yearKey)) {
        groups.set(yearKey, {
          key: yearKey,
          label: yearKey,
          isPreviousYear: Number(yearKey) < Number(currentYear),
          months: [],
          flexMinutes: 0
        });
      }
      const year = groups.get(yearKey)!;
      year.months.push(month);
      year.flexMinutes += month.flexMinutes;
    }
    return Array.from(groups.values()).sort((a, b) => b.key.localeCompare(a.key));
  });

  // Optional computed: count of entries (could drive badge etc.)
  entryCount = computed(() => this.entries().length);

  // React to route param changes
  private routeEffect = effect(() => {
    const pm = this.routeParamMap();
    const routeYmd = pm.get('ymd');
    this.isTodayView.set(!routeYmd);
    const ymd = routeYmd ?? this.clock.today();
    // Only trigger load if changed
    if (this.day() !== ymd) {
      this.day.set(ymd);
      this.ipc.loadDay(ymd);
    }
  });

  private resetDeleteOnDayChange = effect(() => {
    this.day();
    untracked(() => this.resetDeleteConfirm());
  });

  // Today's planned time grows every minute, so keep the balance current while the view is open.
  private refreshFlexEachMinute = effect(() => {
    this.clock.currentTime();
    this.settings();
    untracked(() => this.ipc.loadFlexBalance());
  });

  private keepCurrentMonthExpandedEffect = effect(() => {
    const groups = this.daysByMonth();
    const keys = new Set(groups.map(g => g.key));
    const current = this.currentMonthKey();
    const initialized = this.monthAccordionInitialized();
    this.expandedMonths.update(prev => prev.filter(k => keys.has(k)));

    if (!initialized && groups.length) {
      const initialOpen = keys.has(current) ? [current] : [groups[0].key];
      this.expandedMonths.set(initialOpen);
      this.monthAccordionInitialized.set(true);
    }
  });

  private initializeYearAccordionEffect = effect(() => {
    const years = this.daysByYear();
    const keys = new Set(years.map(y => y.key));
    const current = this.currentYearKey();
    const initialized = this.yearAccordionInitialized();
    this.expandedYears.update(prev => prev.filter(k => keys.has(k)));

    if (!initialized && years.length) {
      const initialOpen = keys.has(current) ? [current] : [years[0].key];
      this.expandedYears.set(initialOpen);
      this.yearAccordionInitialized.set(true);
    }
  });

  private onPointerDown = (ev: PointerEvent) => {
    if (!this.editingKey()) return;
    const menu = document.querySelector('[data-cat-menu]');
    if (menu && !menu.contains(ev.target as Node)) this.cancelEdit();
  };

  // Initial days fetch (service already refreshes days in ctor, but this ensures up-to-date after first render)
  constructor() {
    this.ipc.getDays().then(() => {});
    // Close category menu on outside click
    window.addEventListener('pointerdown', this.onPointerDown);
  }

  ngOnDestroy() {
    window.removeEventListener('pointerdown', this.onPointerDown);
    this.resetDeleteConfirm();
  }

  /** Single slots delete at once; multi-slot blocks need a second click within a few seconds. */
  async removeBlock(block: DayRow) {
    if (this.dayLocked() || !block || block.kind !== 'entry') return;
    if (block.rows.length > 1 && this.confirmDeleteStart() !== block.start) {
      this.resetDeleteConfirm();
      this.confirmDeleteStart.set(block.start);
      this.confirmDeleteTimer = setTimeout(() => this.resetDeleteConfirm(), 4000);
      return;
    }
    this.resetDeleteConfirm();
    const day = this.day();
    try {
      for (const row of block.rows) await this.ipc.deleteEntry(day, row.start);
    } catch {
      this.snackbar.show('Kunne ikke slette registreringen.');
    }
  }

  private resetDeleteConfirm() {
    if (this.confirmDeleteTimer) clearTimeout(this.confirmDeleteTimer);
    this.confirmDeleteTimer = null;
    this.confirmDeleteStart.set(null);
  }

  logBlock(block: DayRow) {
    const day = this.day();
    if (!block || block.kind !== 'missing') return;
    const starts = new Set(block.rows.map(r => r.slotStart ?? r.start));
    this.openLogDialogFor([...starts].map(start => `${day}T${start}`));
  }

  logAllMissing() {
    this.openLogDialogFor(this.missingSlotKeys());
  }

  private openLogDialogFor(slots: string[]) {
    if (this.dayLocked() || !slots.length) return;
    const sorted = [...slots].sort();
    const currentPending = new Set(this.ipc.pendingSlots());
    for (const s of sorted) currentPending.add(s);
    this.ipc.pendingSlots.set(Array.from(currentPending).sort());
    this.ipc.preselectedSlots.set(sorted);
    window.dispatchEvent(new CustomEvent('open-log-dialog', { detail: { slots: sorted } }));
  }

  toggleExported(day: string, ev: Event) {
    const target = ev.target as HTMLInputElement | null;
    if (!day || !target) return;
    this.ipc.setDayExported(day, !!target.checked);
  }

  // New helper for dot indicator (no native checkbox). Toggles by inverting current state.
  toggleExportedDot(day: string) {
    if (!day) return;
    const current = this.ipc.dayExported().get(day) || false;
    const next = !current;
    if (!next) {
      void this.handleArchiveUnset(day);
      return;
    }
    const shouldUseJiraFlow = next && shouldJiraAutoLogOnAfstem(this.ipc.settings());
    if (shouldUseJiraFlow) {
      void this.openArchiveJiraConfirm(day);
      return;
    }
    this.ipc.setDayExported(day, next);
  }

  private async handleArchiveUnset(day: string) {
    const hasJiraIntervals = await this.archiveDayHasJiraLinkedIntervals(day);
    if (hasJiraIntervals) {
      await this.openArchiveJiraUnsetConfirm(day);
      return;
    }
    this.ipc.setDayExported(day, false);
  }

  private async openArchiveJiraUnsetConfirm(day: string) {
    this.archiveJiraUnsetConfirmDay.set(day);
    this.archiveJiraUnsetConfirmError.set('');
    this.archiveJiraUnsetPreviewRows.set([]);
    this.archiveJiraUnsetPreviewLoading.set(true);
    this.archiveJiraUnsetConfirmOpen.set(true);

    const resp = await this.ipc.getJiraLoggedWorklogPreview(day);
    if (!resp.ok) {
      this.archiveJiraUnsetConfirmError.set(resp.error || 'Kunne ikke hente preview af Jira worklogs.');
      this.archiveJiraUnsetPreviewLoading.set(false);
      return;
    }

    this.archiveJiraUnsetPreviewRows.set(
      resp.items.map((row) => ({
        key: row.key,
        summary: (row.summary ?? '').trim(),
        minutes: Math.max(0, Math.round((row.seconds || 0) / 60)),
        startedLabel: this.formatStartedLabel(row.started)
      }))
    );
    this.archiveJiraUnsetPreviewLoading.set(false);
  }

  private async archiveDayHasJiraLinkedIntervals(day: string): Promise<boolean> {
    try {
      const rows = await window.workApi.getSummary(day) as Array<{ description: string; category: string; minutes: number }>;
      return getJiraAfstemRows(rows ?? []).length > 0;
    } catch {
      return false;
    }
  }

  closeArchiveJiraUnsetConfirm() {
    this.archiveJiraUnsetConfirmOpen.set(false);
    this.archiveJiraUnsetConfirmDay.set('');
    this.archiveJiraUnsetConfirmError.set('');
    this.archiveJiraUnsetPreviewLoading.set(false);
    this.archiveJiraUnsetPreviewRows.set([]);
  }

  async confirmArchiveJiraUnset() {
    const day = this.archiveJiraUnsetConfirmDay();
    if (!day) return;
    this.archiveJiraUnsetConfirmError.set('');
    const res = await this.ipc.unsetAfstemtWithJiraCleanup(day);
    if (!res.ok) {
      this.archiveJiraUnsetConfirmError.set(res.error || 'Kunne ikke fjerne Jira worklogs.');
      this.snackbar.show(`Afstem blev ikke fjernet for ${day}. ${res.error || 'Jira-oprydning fejlede.'}`);
      return;
    }
    const removed = Number(res.removed ?? 0);
    const total = Number(res.total ?? removed);
    if (total > 0) {
      this.snackbar.show(`Afstem fjernet for ${day}. Slettede ${removed}/${total} Jira worklogs.`);
    } else {
      this.snackbar.show(`Afstem fjernet for ${day}. Ingen Jira worklogs skulle slettes.`);
    }
    this.closeArchiveJiraUnsetConfirm();
  }

  private formatStartedLabel(started?: string): string {
    const value = String(started ?? '').trim();
    if (!value) return '-';
    const m = value.match(/T(\d{2}:\d{2})/);
    return m?.[1] ?? '-';
  }

  private async openArchiveJiraConfirm(day: string) {
    this.archiveJiraConfirmError.set('');
    this.archiveJiraConfirmLoading.set(true);
    this.archiveJiraConfirmDay.set(day);
    this.archiveJiraConfirmRows.set([]);
    this.archiveJiraConfirmOpen.set(false);
    try {
      const rows = await window.workApi.getSummary(day) as Array<{ description: string; category: string; minutes: number }>;
      const eligible = getJiraAfstemRows(rows ?? []);
      if (!eligible.length) {
        this.ipc.setDayExported(day, true);
        this.snackbar.show('Afstemt gennemført. Ingen tid logget til Jira.');
        this.closeArchiveJiraConfirm();
        return;
      }
      this.archiveJiraConfirmRows.set(eligible);
      this.archiveJiraConfirmOpen.set(true);
    } catch {
      this.archiveJiraConfirmError.set('Kunne ikke hente preview for Jira-logning.');
      this.archiveJiraConfirmRows.set([]);
      this.archiveJiraConfirmOpen.set(true);
    } finally {
      this.archiveJiraConfirmLoading.set(false);
    }
  }

  closeArchiveJiraConfirm() {
    this.archiveJiraConfirmOpen.set(false);
    this.archiveJiraConfirmDay.set('');
    this.archiveJiraConfirmRows.set([]);
    this.archiveJiraConfirmLoading.set(false);
    this.archiveJiraConfirmSubmitting.set(false);
    this.archiveJiraConfirmError.set('');
  }

  async confirmArchiveJiraLog() {
    const day = this.archiveJiraConfirmDay();
    if (!day) return;
    this.archiveJiraConfirmSubmitting.set(true);
    this.archiveJiraConfirmError.set('');
    try {
      const result = await this.ipc.logWorkToJira(day);
      if (!result.ok) {
        this.archiveJiraConfirmError.set(result.error || 'Jira logning fejlede.');
        return;
      }
      await this.ipc.setDayExported(day, true);
      this.closeArchiveJiraConfirm();
    } catch {
      this.archiveJiraConfirmError.set('Uventet fejl under Jira logning.');
    } finally {
      this.archiveJiraConfirmSubmitting.set(false);
    }
  }

  isMonthExpanded(monthKey: string) {
    return this.expandedMonths().includes(monthKey);
  }

  toggleMonth(monthKey: string) {
    if (!monthKey) return;
    this.expandedMonths.update(prev => {
      const set = new Set(prev);
      if (set.has(monthKey)) set.delete(monthKey);
      else set.add(monthKey);
      return Array.from(set);
    });
  }

  isYearExpanded(yearKey: string) {
    return this.expandedYears().includes(yearKey);
  }

  toggleYear(yearKey: string) {
    if (!yearKey) return;
    this.expandedYears.update(prev => {
      const set = new Set(prev);
      if (set.has(yearKey)) set.delete(yearKey);
      else set.add(yearKey);
      return Array.from(set);
    });
  }
}

// Pure helper used for tests (same logic as the rows signal)
export function computeMissingRows(entries: DayRowLike[], settings: WorkScheduleSettingsLike, day: string, nowMinutesSinceMidnight: number): DayRowLike[] {
  if (!day || !settings) return entries;
  return [...entries, ...missingRowsForDay(entries, settings, day, nowMinutesSinceMidnight)]
    .sort((a, b) => a.start.localeCompare(b.start));
}
