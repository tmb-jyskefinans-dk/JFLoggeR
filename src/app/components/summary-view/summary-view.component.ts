import { Component, inject, ChangeDetectionStrategy, signal, computed, effect } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IpcService, SummaryRow } from '../../services/ipc.service';
import { toSignal } from '@angular/core/rxjs-interop';

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
