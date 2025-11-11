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
    this.ipc.getDays().then(() => {});
    // Close category menu on outside click
    window.addEventListener('pointerdown', (ev: PointerEvent) => {
      if (!this.editingKey()) return;
      const menu = document.querySelector('[data-cat-menu]');
      if (menu && !menu.contains(ev.target as Node)) this.cancelEdit();
    });
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

// Pure helper used for tests (reuses logic above without signals)
export function computeMissingRows(entries: { start:string; end:string; description?:string; category?:string }[], settings: { work_start:string; work_end:string; slot_minutes:number }, day: string, now: Date): any[] {
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
  let nowLimitM = Infinity;
  const ymdNow = now.toISOString().slice(0,10);
  if (day === ymdNow) nowLimitM = now.getHours()*60 + now.getMinutes();
  const placeholders: any[] = [];
  for (let m = startM; m < endM; m += slotMinutes) {
    if (m >= nowLimitM) break;
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
