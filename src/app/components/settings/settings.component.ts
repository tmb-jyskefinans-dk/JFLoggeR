import { Component, inject, ChangeDetectionStrategy, effect, signal, computed } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ThemeService } from '../../services/theme.service';
import { DecimalPipe } from '@angular/common';
import { IpcService } from '../../services/ipc.service';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';

@Component({
  selector: 'settings-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DecimalPipe],
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss']
})
export class SettingsComponent {
  ipc = inject(IpcService);
  theme = inject(ThemeService);
  private fb = inject(FormBuilder);

  private readonly weekdayControlNames = [
    'weekday_0',
    'weekday_1',
    'weekday_2',
    'weekday_3',
    'weekday_4',
    'weekday_5',
    'weekday_6'
  ] as const;

  settingsForm = this.fb.nonNullable.group({
    work_start: '08:00',
    work_end: '16:00',
    slot_minutes: 15,
    weekday_0: false,
    weekday_1: true,
    weekday_2: true,
    weekday_3: true,
    weekday_4: true,
    weekday_5: true,
    weekday_6: false,
    azure_tenant_id: '',
    azure_client_id: '',
    jira_psa_key: '',
    jira_project_key: '',
    auto_focus_on_slot: false,
    notification_silent: true,
    stale_threshold_minutes: 45,
    auto_start_on_login: false,
    group_notifications: true,
    minimize_after_notification_submit: false
  });

  private settingsValue = toSignal(this.settingsForm.valueChanges, {
    initialValue: this.settingsForm.getRawValue()
  });

  authBusy = signal<boolean>(false);
  authError = signal<string>('');
  authStatus = this.ipc.authStatus;

  // Import feature signals
  importText = signal<string>('');
  importResult = signal<{ ok: boolean; imported?: number; skipped?: number; details?: { line: number; reason: string }[]; error?: string }|null>(null);
  importing = signal<boolean>(false);

  days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  initialSettings = signal<any|null>(null);

  weekdayState = computed(() => {
    const v = this.settingsValue();
    return this.weekdayControlNames.map(name => !!v[name]);
  });

  // Derived signals
  totalWorkMinutes = computed(() => {
    const v = this.settingsValue();
    const startParts = (v.work_start || '').split(':').map(Number);
    const endParts = (v.work_end || '').split(':').map(Number);
    if (startParts.length < 2 || endParts.length < 2) return 0;
    const startM = startParts[0]*60 + startParts[1];
    const endM = endParts[0]*60 + endParts[1];
    return endM > startM ? (endM - startM) : 0;
  });

  // Computed change detection based on signals
  changed = computed(() => {
    const s = this.initialSettings();
    if (!s) return false;
      const v = this.settingsValue();
    const maskOrig = s.weekdays_mask;
      const maskNow = this.weekdayControlNames.reduce((acc, name, i) => v[name] ? acc | (1 << i) : acc, 0);
      return s.work_start !== v.work_start ||
        s.work_end !== v.work_end ||
        Number(s.slot_minutes) !== Number(v.slot_minutes) ||
           maskOrig !== maskNow ||
        ((s.azure_tenant_id ?? '') !== (v.azure_tenant_id ?? '')) ||
        ((s.azure_client_id ?? '') !== (v.azure_client_id ?? '')) ||
        ((s.jira_psa_key ?? '') !== (v.jira_psa_key ?? '')) ||
        ((s.jira_project_key ?? '') !== (v.jira_project_key ?? '')) ||
        (!!s.auto_focus_on_slot !== !!v.auto_focus_on_slot) ||
        (!!s.notification_silent !== !!v.notification_silent) ||
        (Number(s.stale_threshold_minutes) !== Number(v.stale_threshold_minutes)) ||
        (!!s.auto_start_on_login !== !!v.auto_start_on_login) ||
          (!!s.group_notifications !== !!v.group_notifications) ||
          (!!s.minimize_after_notification_submit !== !!v.minimize_after_notification_submit);
  });

  constructor() {
    const s = this.ipc.settings();
  if (s) { this.apply(s); this.initialSettings.set(s); } else this.ipc.loadSettings();
    this.ipc.loadAuthStatus();
    // Reactively apply settings when signal updates
    effect(() => {
      const v = this.ipc.settings();
      if (v) { this.apply(v); if (!this.initialSettings()) this.initialSettings.set(v); }
    });
  }

  apply(s: any) {
    this.settingsForm.patchValue({
      work_start: s.work_start,
      work_end: s.work_end,
      slot_minutes: Number(s.slot_minutes) || 15,
      weekday_0: (s.weekdays_mask & (1 << 0)) !== 0,
      weekday_1: (s.weekdays_mask & (1 << 1)) !== 0,
      weekday_2: (s.weekdays_mask & (1 << 2)) !== 0,
      weekday_3: (s.weekdays_mask & (1 << 3)) !== 0,
      weekday_4: (s.weekdays_mask & (1 << 4)) !== 0,
      weekday_5: (s.weekdays_mask & (1 << 5)) !== 0,
      weekday_6: (s.weekdays_mask & (1 << 6)) !== 0,
      azure_tenant_id: s.azure_tenant_id ?? '',
      azure_client_id: s.azure_client_id ?? '',
      jira_psa_key: s.jira_psa_key ?? '',
      jira_project_key: s.jira_project_key ?? '',
      auto_focus_on_slot: !!s.auto_focus_on_slot,
      notification_silent: !!s.notification_silent,
      stale_threshold_minutes: Number(s.stale_threshold_minutes) || 45,
      auto_start_on_login: !!s.auto_start_on_login,
      group_notifications: !!s.group_notifications,
      minimize_after_notification_submit: !!s.minimize_after_notification_submit
    });
  }

  async save() {
    const raw = this.settingsForm.getRawValue();
    const weekdays_mask = this.weekdayControlNames.reduce((acc, name, i) => raw[name] ? acc | (1 << i) : acc, 0);
    const payload = {
      work_start: raw.work_start,
      work_end: raw.work_end,
      slot_minutes: Number(raw.slot_minutes),
      weekdays_mask,
      azure_tenant_id: raw.azure_tenant_id.trim(),
      azure_client_id: raw.azure_client_id.trim(),
      jira_psa_key: raw.jira_psa_key.trim(),
      jira_project_key: raw.jira_project_key.trim().toUpperCase(),
      auto_focus_on_slot: raw.auto_focus_on_slot,
      notification_silent: raw.notification_silent,
      stale_threshold_minutes: Number(raw.stale_threshold_minutes),
      auto_start_on_login: raw.auto_start_on_login,
      group_notifications: raw.group_notifications,
      minimize_after_notification_submit: raw.minimize_after_notification_submit
    };
    try {
      await this.ipc.saveSettings(payload);
      // Update baseline after successful save for accurate change detection.
      this.initialSettings.set(payload);
    } catch {
      // Keep baseline unchanged on failure so user can retry save.
    }
  }

  reset() {
    const s = this.initialSettings();
    if (s) this.apply(s);
  }

  toggleWeekday(i: number) {
    const key = this.weekdayControlNames[i];
    if (!key) return;
    const ctrl = this.settingsForm.controls[key];
    ctrl.setValue(!ctrl.value);
  }

  async signInMicrosoft() {
    this.authError.set('');
    this.authBusy.set(true);
    try {
      const resp = await this.ipc.signInMicrosoft();
      if (!resp?.ok) {
        this.authError.set(resp?.error ?? 'Sign-in failed');
      }
      await this.ipc.loadAuthStatus();
    } catch (err) {
      this.authError.set(String(err));
    } finally {
      this.authBusy.set(false);
    }
  }

  async signOutMicrosoft() {
    this.authError.set('');
    this.authBusy.set(true);
    try {
      const resp = await this.ipc.signOutMicrosoft();
      if (!resp?.ok) {
        this.authError.set(resp?.error ?? 'Sign-out failed');
      }
      await this.ipc.loadAuthStatus();
    } catch (err) {
      this.authError.set(String(err));
    } finally {
      this.authBusy.set(false);
    }
  }

  performImport() {
    const raw = this.importText().trim();
    if (!raw) return;
    this.importing.set(true);
    this.ipc.importExternal(raw)
      .then(res => this.importResult.set(res))
      .catch(err => this.importResult.set({ ok: false, error: String(err) }))
      .finally(() => this.importing.set(false));
  }

  clearImport() { this.importText.set(''); this.importResult.set(null); }
}
