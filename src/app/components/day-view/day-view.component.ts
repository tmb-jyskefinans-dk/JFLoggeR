import { Component, inject, ChangeDetectionStrategy, signal, computed, effect } from '@angular/core';
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
