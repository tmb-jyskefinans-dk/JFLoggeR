import { Component, inject, ChangeDetectionStrategy, effect, signal, computed } from '@angular/core';
import { ThemeService } from '../../services/theme.service';
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
  theme = inject(ThemeService);

  // Signals replacing primitive fields
  workStart = signal<string>('08:00');
  workEnd = signal<string>('16:00');
  slotMinutes = signal<number>(15);
  weekdayState = signal<boolean[]>([false, true, true, true, true, true, false]);
  autoFocusOnSlot = signal<boolean>(false);
  notificationSilent = signal<boolean>(true);
  staleThresholdMinutes = signal<number>(45);
  autoStartOnLogin = signal<boolean>(false);
  groupNotifications = signal<boolean>(true);

  days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  initialSettings = signal<any|null>(null);

  // Derived signals
  totalWorkMinutes = computed(() => {
    const startParts = this.workStart().split(':').map(Number);
    const endParts = this.workEnd().split(':').map(Number);
    if (startParts.length < 2 || endParts.length < 2) return 0;
    const startM = startParts[0]*60 + startParts[1];
    const endM = endParts[0]*60 + endParts[1];
    return endM > startM ? (endM - startM) : 0;
  });

  // Computed change detection based on signals
  changed = computed(() => {
    const s = this.initialSettings();
    if (!s) return false;
    const maskOrig = s.weekdays_mask;
    const maskNow = this.weekdayState().reduce((acc,on,i)=> on? acc | (1<<i): acc,0);
    return s.work_start !== this.workStart() ||
           s.work_end !== this.workEnd() ||
           s.slot_minutes !== this.slotMinutes() ||
           maskOrig !== maskNow ||
           (!!s.auto_focus_on_slot !== this.autoFocusOnSlot()) ||
           (!!s.notification_silent !== this.notificationSilent()) ||
           (Number(s.stale_threshold_minutes) !== this.staleThresholdMinutes()) ||
           (!!s.auto_start_on_login !== this.autoStartOnLogin()) ||
           (!!s.group_notifications !== this.groupNotifications());
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
    this.workStart.set(s.work_start);
    this.workEnd.set(s.work_end);
    this.slotMinutes.set(s.slot_minutes);
    this.weekdayState.set(Array.from({length:7},(_,i)=> (s.weekdays_mask & (1<<i))!==0));
    this.autoFocusOnSlot.set(!!s.auto_focus_on_slot);
    this.notificationSilent.set(!!s.notification_silent);
    this.staleThresholdMinutes.set(Number(s.stale_threshold_minutes) || 45);
    this.autoStartOnLogin.set(!!s.auto_start_on_login);
    this.groupNotifications.set(!!s.group_notifications);
  }

  save() {
    const weekdays_mask = this.weekdayState().reduce((acc, on, i)=> on? acc | (1<<i): acc, 0);
    const payload = {
      work_start: this.workStart(),
      work_end: this.workEnd(),
      slot_minutes: Number(this.slotMinutes()),
      weekdays_mask,
      auto_focus_on_slot: this.autoFocusOnSlot(),
      notification_silent: this.notificationSilent(),
      stale_threshold_minutes: Number(this.staleThresholdMinutes()),
      auto_start_on_login: this.autoStartOnLogin(),
      group_notifications: this.groupNotifications()
    };
    this.ipc.saveSettings(payload);
    // Update baseline after save for change detection
    this.initialSettings.set(payload);
  }

  reset() {
    const s = this.initialSettings();
    if (s) this.apply(s);
  }

  toggleWeekday(i: number) {
    this.weekdayState.update(arr => {
      const copy = [...arr];
      copy[i] = !copy[i];
      return copy;
    });
  }
}
