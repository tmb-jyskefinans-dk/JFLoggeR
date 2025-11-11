import { Component, inject, ChangeDetectionStrategy, signal, computed, effect } from '@angular/core';
import { getCategoryColor } from '../../models/category-colors';
import { CATEGORY_GROUPS } from '../../models/categories';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IpcService } from '../../services/ipc.service';
import { ClockService } from '../../services/clock.service';

@Component({
  selector: 'day-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  templateUrl: './day-view.component.html',
  styleUrls: ['./day-view.component.scss']
})
export class DayViewComponent  {
  route = inject(ActivatedRoute);
  ipc = inject(IpcService);
  clock = inject(ClockService);

  // Source signals
  day = signal<string>('');

  // Derived / mirrored signals from service
  entries = computed(() => this.ipc.dayEntries());
  days = computed(() => this.ipc.days());
  settings = computed(() => this.ipc.settings());

  /**
   * Combined rows (real entries + missing placeholder intervals) sorted by start time.
   * A placeholder row has shape { start: string; end: string; missing: true }.
   */
  rows = computed(() => {
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
      const now = new Date();
      nowLimitM = now.getHours() * 60 + now.getMinutes();
    }
    const placeholders: any[] = [];
    for (let m = startM; m < endM; m += slotMinutes) {
      if (m >= nowLimitM) break; // don't show future intervals for current day
      if (!covered.has(m)) {
        const h = Math.floor(m / 60), mm = m % 60;
        const start = `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
        const endMin = m + slotMinutes;
        const eh = Math.floor(endMin / 60), emm = endMin % 60;
        const end = `${String(eh).padStart(2,'0')}:${String(emm).padStart(2,'0')}`;
        placeholders.push({ start, end, description: '', category: '', missing: true });
      }
    }
    // Merge & sort
    const merged = [...list, ...placeholders].sort((a:any,b:any)=> a.start.localeCompare(b.start));
    return merged;
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

  // Optional computed: count of entries (could drive badge etc.)
  entryCount = computed(() => this.entries().length);

  // React to route param changes
  private routeEffect = effect(() => {
    this.route.paramMap.subscribe(pm => {
      const ymd = pm.get('ymd') ?? this.clock.today();
      // Only trigger load if changed
      if (this.day() !== ymd) {
        this.day.set(ymd);
        this.ipc.loadDay(ymd);
      }
    });
  });

  // Initial days fetch (service already refreshes days in ctor, but this ensures up-to-date after first render)
  constructor() {
    this.ipc.getDays().then(list => { /* service will set its signal; no manual set needed */ });
  }

  remove(e: any) {
    if (!e || !e.day || !e.start) return;
    this.ipc.deleteEntry(e.day, e.start);
  }

  /** Add a missing slot to the pending list & open the log dialog pre-selecting it. */
  logMissing(start: string) {
    const day = this.day();
    if (!day || !start) return;
    const slotKey = `${day}T${start}`;
    // Ensure pendingSlots signal includes it so dialog can select it.
    const current = this.ipc.pendingSlots();
    if (!current.includes(slotKey)) this.ipc.pendingSlots.set([...current, slotKey].sort());
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
    this.ipc.setDayExported(day, !current);
  }
}
