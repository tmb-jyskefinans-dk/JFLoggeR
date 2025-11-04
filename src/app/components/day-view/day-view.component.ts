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
    return { ...d, weekday: this.weekdayNames[dt.getDay()] };
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
}
