import { Component, inject, ChangeDetectionStrategy, signal, computed, effect, OnDestroy } from '@angular/core';
import { getCategoryColor } from '../../models/category-colors';
import { CATEGORY_GROUPS } from '../../models/categories';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { IpcService } from '../../services/ipc.service';
import { ClockService } from '../../services/clock.service';

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
  routeParamMap = toSignal(this.route.paramMap, { initialValue: this.route.snapshot.paramMap });

  // Source signals
  day = signal<string>('');
  isTodayView = signal(false);
  selectedMissingSlots = signal<string[]>([]);
  archiveJiraConfirmOpen = signal(false);
  archiveJiraConfirmDay = signal('');
  archiveJiraConfirmRows = signal<Array<{ description: string; category: string; minutes: number }>>([]);
  archiveJiraConfirmLoading = signal(false);
  archiveJiraConfirmSubmitting = signal(false);
  archiveJiraConfirmError = signal('');
  archiveJiraUnsetConfirmOpen = signal(false);
  archiveJiraUnsetConfirmDay = signal('');
  private readonly jiraCategories = new Set([
    'Udvikling (prioriterede jf. projektoversigten)',
    'Estimering'
  ]);

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

  beginEdit(row: any, ev?: Event) {
    if (!row || row.missing) return;
    const key = `${row.day}T${row.start}`;
    this.editingKey.set(key);
    // Compute viewport position for dropdown to avoid scroll container clipping
    if (ev && ev.target) {
      const el = (ev.target as HTMLElement).closest('td') || (ev.target as HTMLElement);
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
  isEditing(row: any) { return !!row && !row.missing && this.editingKey() === `${row.day}T${row.start}`; }
  applyCategory(row: any, cat: string) {
    if (!row || row.missing || !cat) return;
    const entry = { day: row.day, start: row.start, end: row.end, description: row.description, category: cat };
    try { (window as any).workApi.saveEntries([entry]); } catch { }
    // Refresh signals
    this.ipc.loadDay(this.day());
    this.ipc.refreshDays();
    this.editingKey.set(null);
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
   * Combined rows (real entries + missing placeholder intervals) sorted by start time.
   * A placeholder row has shape { start: string; end: string; missing: true }.
   * Depends on clock.currentTime() to auto-update missing blocks as time passes.
   */
  rows = computed(() => {
    // Include currentTime to trigger refresh every minute
    this.clock.currentTime();
    
    const list = this.entries();
    const s = this.settings();
    const day = this.day();
    if (!day || !s) return list;
    const slotMinutes: number = Number(s.slot_minutes) || 15;
    const workStart: string = s.work_start;
    const workEnd: string = s.work_end;
    if (!workStart || !workEnd) return list;
    // Parse work window
    const [wsh, wsm] = workStart.split(':').map(Number);
    const [weh, wem] = workEnd.split(':').map(Number);
    const startM = wsh * 60 + wsm;
    const endM = weh * 60 + wem;
    if (endM <= startM) return list;
    // Build coverage set of slot start minutes covered by existing entries.
    // Entry coverage: any slot whose start minute >= entry.start and < entry.end considered covered.
    const covered = new Set<number>();
    for (const e of list) {
      if (!e.start || !e.end) continue;
      const [sh, sm] = e.start.split(':').map(Number);
      const [eh, em] = e.end.split(':').map(Number);
      const es = sh * 60 + sm;
      const ee = eh * 60 + em;
      if (ee <= es) continue; // skip invalid
      for (let m = es; m < ee; m += slotMinutes) {
        if (m % slotMinutes === 0) covered.add(m);
      }
    }
    // Current time filtering for today: only include missing slots that have ended already.
    let nowLimitM = Infinity;
    if (day === this.clock.today()) {
      nowLimitM = this.clock.currentTime();
    }
    const placeholders: any[] = [];
    const placeholderStarts = new Set<string>();
    for (let m = startM; m < endM; m += slotMinutes) {
      if (m >= nowLimitM) break; // don't show future intervals for current day
      if (!covered.has(m)) {
        const h = Math.floor(m / 60), mm = m % 60;
        const start = `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
        const endMin = m + slotMinutes;
        const eh = Math.floor(endMin / 60), emm = endMin % 60;
        const end = `${String(eh).padStart(2,'0')}:${String(emm).padStart(2,'0')}`;
        placeholders.push({ start, end, description: '', category: '', missing: true });
        placeholderStarts.add(start);
      }
    }

    // Also include live pending slots for this day so notification-triggered slots
    // appear immediately, even before the minute ticker catches up.
    const pendingForDay = this.pendingSlotsForDay();
    for (const slot of pendingForDay) {
      const start = slot.slice(11, 16);
      if (!start || placeholderStarts.has(start)) continue;
      const [sh, sm] = start.split(':').map(Number);
      const startMins = sh * 60 + sm;
      if (covered.has(startMins)) continue;
      const endMin = startMins + slotMinutes;
      const eh = Math.floor(endMin / 60), emm = endMin % 60;
      const end = `${String(eh).padStart(2,'0')}:${String(emm).padStart(2,'0')}`;
      placeholders.push({ start, end, description: '', category: '', missing: true });
      placeholderStarts.add(start);
    }

    // Merge & sort
    const merged = [...list, ...placeholders].sort((a:any,b:any)=> a.start.localeCompare(b.start));
    return merged;
  });

  missingSlotKeys = computed(() => {
    const day = this.day();
    if (!day) return [] as string[];
    return this.rows()
      .filter(r => !!r?.missing)
      .map(r => `${day}T${r.start}`);
  });

  allMissingSelected = computed(() => {
    const missing = this.missingSlotKeys();
    const selected = this.selectedMissingSlots();
    return missing.length > 0 && missing.every(s => selected.includes(s));
  });

  selectedMissingCount = computed(() => this.selectedMissingSlots().length);

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
  formattedDay = computed(() => {
    const ymd = this.day();
    if (!ymd) return '';
    const [y,m,d] = ymd.split('-').map(Number);
    const dt = new Date(y, (m||1)-1, d||1);
    return `${this.weekdayNames[dt.getDay()]} ${ymd}`;
  });
  daysWithWeekday = computed(() => this.days().map(d => {
    const [y,m,dd] = d.day.split('-').map(Number);
    const dt = new Date(y,(m||1)-1,dd||1);
    const exported = this.ipc.dayExported().get(d.day) || false;
    return { ...d, weekday: this.weekdayNames[dt.getDay()], exported };
  }));

  currentMonthKey = computed(() => this.clock.today().slice(0, 7));
  currentYearKey = computed(() => this.clock.today().slice(0, 4));
  expandedMonths = signal<string[]>([]);
  expandedYears = signal<string[]>([]);
  private monthAccordionInitialized = signal(false);
  private yearAccordionInitialized = signal(false);

  daysByMonth = computed(() => {
    const sorted = [...this.daysWithWeekday()].sort((a, b) => b.day.localeCompare(a.day));
    const groups = new Map<string, { key: string; label: string; days: typeof sorted }>();
    for (const d of sorted) {
      const key = d.day.slice(0, 7); // YYYY-MM
      if (!groups.has(key)) {
        const [y, m] = key.split('-').map(Number);
        const label = new Date(y, (m || 1) - 1, 1).toLocaleDateString('da-DK', {
          month: 'long',
          year: 'numeric'
        });
        groups.set(key, { key, label, days: [] });
      }
      groups.get(key)!.days.push(d);
    }
    return Array.from(groups.values());
  });

  daysByYear = computed(() => {
    const months = this.daysByMonth();
    const groups = new Map<string, { key: string; label: string; isPreviousYear: boolean; months: typeof months }>();
    const currentYear = this.currentYearKey();
    for (const month of months) {
      const yearKey = month.key.slice(0, 4);
      if (!groups.has(yearKey)) {
        groups.set(yearKey, {
          key: yearKey,
          label: yearKey,
          isPreviousYear: Number(yearKey) < Number(currentYear),
          months: []
        });
      }
      groups.get(yearKey)!.months.push(month);
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

  private pruneSelectionEffect = effect(() => {
    const missing = new Set(this.missingSlotKeys());
    const selected = this.selectedMissingSlots();
    const next = selected.filter(s => missing.has(s));
    if (next.length !== selected.length) this.selectedMissingSlots.set(next);
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
  }

  remove(e: any) {
    if (!e || !e.day || !e.start) return;
    this.ipc.deleteEntry(e.day, e.start);
  }

  isMissingSelected(start: string) {
    const day = this.day();
    if (!day || !start) return false;
    return this.selectedMissingSlots().includes(`${day}T${start}`);
  }

  toggleMissingSelection(start: string) {
    const day = this.day();
    if (!day || !start) return;
    const key = `${day}T${start}`;
    const set = new Set(this.selectedMissingSlots());
    set.has(key) ? set.delete(key) : set.add(key);
    this.selectedMissingSlots.set(Array.from(set).sort());
  }

  toggleAllMissingSelection() {
    if (this.allMissingSelected()) this.selectedMissingSlots.set([]);
    else this.selectedMissingSlots.set([...this.missingSlotKeys()].sort());
  }

  logSelectedMissing() {
    const selected = this.selectedMissingSlots();
    if (!selected.length) return;
    const currentPending = new Set(this.ipc.pendingSlots());
    for (const s of selected) currentPending.add(s);
    this.ipc.pendingSlots.set(Array.from(currentPending).sort());
    this.ipc.preselectedSlots.set([...selected].sort());
    try {
      window.dispatchEvent(new CustomEvent('open-log-dialog', { detail: { slots: selected } }));
    } catch { /* ignore */ }
  }

  /** Add a missing slot to the pending list & open the log dialog pre-selecting it. */
  logMissing(start: string) {
    const day = this.day();
    if (!day || !start) return;
    const slotKey = `${day}T${start}`;
    // Ensure pendingSlots signal includes it so dialog can select it.
    const current = this.ipc.pendingSlots();
    if (!current.includes(slotKey)) this.ipc.pendingSlots.set([...current, slotKey].sort());
    this.ipc.preselectedSlots.set([slotKey]);
    // Set prompt slot so LogDialog can auto-select it
    try { this.ipc.lastPromptSlot.set(slotKey); } catch { /* ignore */ }
    // Dispatch custom event listened by AppComponent to open dialog.
    try {
      window.dispatchEvent(new CustomEvent('open-log-dialog', { detail: { slot: slotKey } }));
    } catch { /* ignore */ }
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
    const shouldUseJiraFlow = next && !!this.ipc.settings()?.jira_log_on_afstem && !!this.ipc.settings()?.jira_psa_key;
    if (shouldUseJiraFlow) {
      void this.openArchiveJiraConfirm(day);
      return;
    }
    this.ipc.setDayExported(day, next);
  }

  private async handleArchiveUnset(day: string) {
    const warnOnUnset = !!this.ipc.settings()?.jira_log_on_afstem;
    if (!warnOnUnset) {
      this.ipc.setDayExported(day, false);
      return;
    }
    const hasJiraIntervals = await this.archiveDayHasJiraLinkedIntervals(day);
    if (hasJiraIntervals) {
      this.archiveJiraUnsetConfirmDay.set(day);
      this.archiveJiraUnsetConfirmOpen.set(true);
      return;
    }
    this.ipc.setDayExported(day, false);
  }

  private async archiveDayHasJiraLinkedIntervals(day: string): Promise<boolean> {
    try {
      const rows = await window.workApi.getSummary(day) as Array<{ description: string; category: string; minutes: number }>;
      return (rows ?? []).some(r =>
        this.jiraCategories.has(r.category) && /^[A-Z]+-\d+\s*-\s*/.test(r.description)
      );
    } catch {
      return false;
    }
  }

  closeArchiveJiraUnsetConfirm() {
    this.archiveJiraUnsetConfirmOpen.set(false);
    this.archiveJiraUnsetConfirmDay.set('');
  }

  confirmArchiveJiraUnset() {
    const day = this.archiveJiraUnsetConfirmDay();
    if (!day) return;
    this.ipc.setDayExported(day, false);
    this.closeArchiveJiraUnsetConfirm();
  }

  private async openArchiveJiraConfirm(day: string) {
    this.archiveJiraConfirmError.set('');
    this.archiveJiraConfirmLoading.set(true);
    this.archiveJiraConfirmDay.set(day);
    this.archiveJiraConfirmRows.set([]);
    this.archiveJiraConfirmOpen.set(true);
    try {
      const rows = await window.workApi.getSummary(day) as Array<{ description: string; category: string; minutes: number }>;
      const eligible = (rows ?? []).filter(r =>
        this.jiraCategories.has(r.category) && /^[A-Z]+-\d+\s*-\s*/.test(r.description)
      );
      this.archiveJiraConfirmRows.set(eligible);
    } catch {
      this.archiveJiraConfirmError.set('Kunne ikke hente preview for Jira-logning.');
      this.archiveJiraConfirmRows.set([]);
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

// Pure helper used for tests (reuses logic above without signals)
export function computeMissingRows(entries: { start:string; end:string; description?:string; category?:string }[], settings: { work_start:string; work_end:string; slot_minutes:number }, day: string, nowMinutesSinceMidnight: number): any[] {
  if (!day || !settings) return entries;
  const slotMinutes = Number(settings.slot_minutes) || 15;
  const [wsh,wsm] = settings.work_start.split(':').map(Number);
  const [weh,wem] = settings.work_end.split(':').map(Number);
  const startM = wsh*60+wsm, endM = weh*60+wem;
  if (endM <= startM) return entries;
  const covered = new Set<number>();
  for (const e of entries) {
    if (!e.start || !e.end) continue;
    const [sh,sm] = e.start.split(':').map(Number);
    const [eh,em] = e.end.split(':').map(Number);
    const es = sh*60+sm, ee = eh*60+em;
    if (ee <= es) continue;
    for (let m = es; m < ee; m += slotMinutes) if (m % slotMinutes === 0) covered.add(m);
  }
  const placeholders: any[] = [];
  for (let m = startM; m < endM; m += slotMinutes) {
    if (m >= nowMinutesSinceMidnight) break;
    if (!covered.has(m)) {
      const h = Math.floor(m/60), mm = m%60;
      const start = `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
      const endMin = m + slotMinutes;
      const eh = Math.floor(endMin/60), emm = endMin%60;
      const end = `${String(eh).padStart(2,'0')}:${String(emm).padStart(2,'0')}`;
      placeholders.push({ start, end, description:'', category:'', missing:true });
    }
  }
  return [...entries, ...placeholders].sort((a:any,b:any)=> a.start.localeCompare(b.start));
}
