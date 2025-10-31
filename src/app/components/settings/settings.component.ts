import { Component, inject, ChangeDetectionStrategy, effect, signal, computed } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { IpcService } from '../../services/ipc.service';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'settings-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, DecimalPipe],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent {
  ipc = inject(IpcService);

  work_start = '08:00';
  work_end = '16:00';
  slot_minutes = 15;

  days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  weekdayState = [false,true,true,true,true,true,false];
  initialSettings = signal<any|null>(null);

  // Derived signals
  totalWorkMinutes = computed(() => {
    const startParts = this.work_start.split(':').map(Number);
    const endParts = this.work_end.split(':').map(Number);
    if (startParts.length < 2 || endParts.length < 2) return 0;
    const startM = startParts[0]*60 + startParts[1];
    const endM = endParts[0]*60 + endParts[1];
    return endM > startM ? (endM - startM) : 0;
  });

  changed = computed(() => {
    const s = this.initialSettings();
    if (!s) return false;
    const maskOrig = s.weekdays_mask;
    const maskNow = this.weekdayState.reduce((acc,on,i)=> on? acc | (1<<i): acc,0);
    return s.work_start !== this.work_start || s.work_end !== this.work_end || s.slot_minutes !== this.slot_minutes || maskOrig !== maskNow;
  });

  constructor() {
    const s = this.ipc.settings();
  if (s) { this.apply(s); this.initialSettings.set(s); } else this.ipc.loadSettings();
    // Reactively apply settings when signal updates
    effect(() => {
      const v = this.ipc.settings();
      if (v) { this.apply(v); if (!this.initialSettings()) this.initialSettings.set(v); }
    });
  }

  apply(s: any) {
    this.work_start = s.work_start;
    this.work_end = s.work_end;
    this.slot_minutes = s.slot_minutes;
    this.weekdayState = Array.from({length:7},(_,i)=> (s.weekdays_mask & (1<<i))!==0);
  }

  save() {
    const weekdays_mask = this.weekdayState.reduce((acc, on, i)=> on? acc | (1<<i): acc, 0);
    this.ipc.saveSettings({
      work_start: this.work_start,
      work_end: this.work_end,
      slot_minutes: Number(this.slot_minutes),
      weekdays_mask
    });
    // Update baseline after save for change detection
    this.initialSettings.set({
      work_start: this.work_start,
      work_end: this.work_end,
      slot_minutes: Number(this.slot_minutes),
      weekdays_mask
    });
  }

  reset() {
    const s = this.initialSettings();
    if (s) this.apply(s);
  }
}
