import { Component, inject, ChangeDetectionStrategy, effect, signal, computed, OnDestroy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ThemeService } from '../../services/theme.service';
import { DecimalPipe } from '@angular/common';
import { IpcService, JiraConnection, JiraDeployment, JiraIdentityResult } from '../../services/ipc.service';
import { FormArray, FormBuilder, FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { isJiraConnectionUsable } from '../shared/jira-afstem.util';
import {
  ALL_WORK_SLOT_STARTS,
  effectiveSlotMinutes,
  emptyWorkSchedule,
  normalizeWorkSchedule,
  scheduleFromInterval,
  schedulesEqual,
  WORK_SLOT_MINUTES,
  type WorkSchedule,
  type WorkScheduleMode
} from '../../models/work-schedule';

type JiraConnectionForm = FormGroup<{
  id: FormControl<string>;
  name: FormControl<string>;
  type: FormControl<JiraDeployment>;
  base_url: FormControl<string>;
  project_key: FormControl<string>;
  token: FormControl<string>;
  email: FormControl<string>;
}>;

const DEFAULT_ONPREM_JIRA_URL = 'https://app-jira.corp.jyskebank.net/jira';

function jiraConnectionsSnapshot(list: unknown): string {
  const rows = Array.isArray(list) ? list as Array<Partial<JiraConnection>> : [];
  return JSON.stringify(rows.map((c) => {
    const type = c?.type === 'cloud' ? 'cloud' : 'server';
    return [
      String(c?.id ?? ''),
      String(c?.name ?? '').trim(),
      type,
      String(c?.base_url ?? '').trim().replace(/\/+$/, ''),
      String(c?.project_key ?? '').trim().toUpperCase(),
      String(c?.token ?? '').trim(),
      type === 'cloud' ? String(c?.email ?? '').trim() : ''
    ];
  }));
}

@Component({
  selector: 'settings-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, DecimalPipe],
  host: {
    '(window:beforeunload)': 'onWindowBeforeUnload($event)',
    '(window:pointerup)': 'endScheduleDrag()',
    '(window:pointercancel)': 'endScheduleDrag()'
  },
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
    work_schedule_mode: 'interval' as WorkScheduleMode,
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
    jira_active_connection_id: '',
    jira_connections: new FormArray<JiraConnectionForm>([]),
    auto_focus_on_slot: false,
    notification_silent: true,
    stale_threshold_minutes: 45,
    auto_start_on_login: false,
    group_notifications: true,
    minimize_after_notification_submit: false,
    island_os_notifications: false,
    jira_log_on_afstem: false
  });
  readonly jiraConnections = this.settingsForm.controls.jira_connections;

  private settingsValue = toSignal(this.settingsForm.valueChanges, {
    initialValue: this.settingsForm.getRawValue()
  });
  readonly workSlots = ALL_WORK_SLOT_STARTS;
  readonly workSlotMinutes = WORK_SLOT_MINUTES;
  readonly hourHeaders = ALL_WORK_SLOT_STARTS.filter((_, index) => index % 4 === 0);
  workSchedule = signal<WorkSchedule>(emptyWorkSchedule());
  private dragActive = false;
  private dragTargetState = false;
  private dragVisited = new Set<string>();

  isWeeklyMode = computed(() => this.settingsValue().work_schedule_mode === 'weekly');
  scheduleSets = computed(() => this.workSchedule().map(slots => new Set(slots)));
  importSlotMinutes = computed(() => effectiveSlotMinutes(this.ipc.settings()));

  authBusy = signal<boolean>(false);
  authError = signal<string>('');
  authStatus = this.ipc.authStatus;
  jiraVerifyBusyIds = signal<ReadonlySet<string>>(new Set());
  jiraVerifyResults = signal<Readonly<Record<string, JiraIdentityResult>>>({});
  private autoJiraVerifyAttempted = false;
  saveToast = signal<{ message: string; kind: 'success' | 'error' } | null>(null);
  private saveToastTimer: ReturnType<typeof setTimeout> | null = null;
  showUnsavedDialog = signal<boolean>(false);
  leaveDialogBusy = signal<boolean>(false);
  private pendingLeaveResolver: ((allow: boolean) => void) | null = null;
  private pendingLeavePromise: Promise<boolean> | null = null;

  // Import feature signals
  importText = signal<string>('');
  importResult = signal<{ ok: boolean; imported?: number; skipped?: number; details?: { line: number; reason: string }[]; error?: string }|null>(null);
  importing = signal<boolean>(false);

  days = ['Søn','Man','Tir','Ons','Tor','Fre','Lør'];
  initialSettings = signal<any|null>(null);

  weekdayState = computed(() => {
    const v = this.settingsValue();
    return this.weekdayControlNames.map(name => !!v[name]);
  });

  hasUsableJiraConnection = computed(() =>
    (this.settingsValue().jira_connections ?? []).some((c) => isJiraConnectionUsable(c))
  );

  // Derived signals
  totalWorkMinutes = computed(() => {
    const v = this.settingsValue();
    if (v.work_schedule_mode === 'weekly') {
      return this.workSchedule().reduce((total, slots) => total + slots.length * WORK_SLOT_MINUTES, 0);
    }
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
        (s.work_schedule_mode === 'weekly' ? 'weekly' : 'interval') !== v.work_schedule_mode ||
        (v.work_schedule_mode === 'weekly' && !schedulesEqual(normalizeWorkSchedule(s.work_schedule), this.workSchedule())) ||
        ((s.azure_tenant_id ?? '') !== (v.azure_tenant_id ?? '')) ||
        ((s.azure_client_id ?? '') !== (v.azure_client_id ?? '')) ||
        ((s.jira_active_connection_id ?? '') !== (v.jira_active_connection_id ?? '')) ||
        (jiraConnectionsSnapshot(s.jira_connections) !== jiraConnectionsSnapshot(v.jira_connections)) ||
        (!!s.auto_focus_on_slot !== !!v.auto_focus_on_slot) ||
        (!!s.notification_silent !== !!v.notification_silent) ||
        (Number(s.stale_threshold_minutes) !== Number(v.stale_threshold_minutes)) ||
        (!!s.auto_start_on_login !== !!v.auto_start_on_login) ||
          (!!s.group_notifications !== !!v.group_notifications) ||
          (!!s.minimize_after_notification_submit !== !!v.minimize_after_notification_submit) ||
          (!!s.island_os_notifications !== !!v.island_os_notifications) ||
          (!!s.jira_log_on_afstem !== !!v.jira_log_on_afstem);
  });

  constructor() {
    const s = this.ipc.settings();
  if (s) { this.apply(s); this.initialSettings.set(s); } else this.ipc.loadSettings();
    this.ipc.loadAuthStatus();
    // Apply the asynchronous initial load once. Later emissions must not overwrite local edits.
    effect(() => {
      const v = this.ipc.settings();
      if (v && !this.initialSettings()) {
        this.apply(v);
        this.initialSettings.set(v);
      }

      // Show linked Jira accounts automatically when connections already exist.
      if (v && !this.autoJiraVerifyAttempted) {
        this.autoJiraVerifyAttempted = true;
        this.verifyAllJiraConnections();
      }
    });
  }

  apply(s: any) {
    this.workSchedule.set(normalizeWorkSchedule(s.work_schedule));
    this.jiraConnections.clear({ emitEvent: false });
    for (const c of Array.isArray(s.jira_connections) ? s.jira_connections : []) {
      this.jiraConnections.push(this.createJiraConnectionGroup(c), { emitEvent: false });
    }
    this.settingsForm.patchValue({
      work_schedule_mode: s.work_schedule_mode === 'weekly' ? 'weekly' : 'interval',
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
      jira_active_connection_id: s.jira_active_connection_id ?? '',
      auto_focus_on_slot: !!s.auto_focus_on_slot,
      notification_silent: !!s.notification_silent,
      stale_threshold_minutes: Number(s.stale_threshold_minutes) || 45,
      auto_start_on_login: !!s.auto_start_on_login,
      group_notifications: !!s.group_notifications,
      minimize_after_notification_submit: !!s.minimize_after_notification_submit,
      island_os_notifications: !!s.island_os_notifications,
      jira_log_on_afstem: !!s.jira_log_on_afstem
    });
  }

  async save(): Promise<boolean> {
    const raw = this.settingsForm.getRawValue();
    const weekdays_mask = this.weekdayControlNames.reduce((acc, name, i) => raw[name] ? acc | (1 << i) : acc, 0);
    const payload = {
      work_start: raw.work_start,
      work_end: raw.work_end,
      slot_minutes: Number(raw.slot_minutes),
      weekdays_mask,
      work_schedule_mode: raw.work_schedule_mode,
      work_schedule: this.workSchedule(),
      azure_tenant_id: raw.azure_tenant_id.trim(),
      azure_client_id: raw.azure_client_id.trim(),
      jira_connections: raw.jira_connections.map((c) => ({
        id: c.id,
        name: c.name.trim(),
        type: c.type,
        base_url: c.base_url.trim(),
        project_key: c.project_key.trim().toUpperCase(),
        token: c.token.trim(),
        email: c.type === 'cloud' ? c.email.trim() : ''
      })),
      jira_active_connection_id: raw.jira_active_connection_id,
      auto_focus_on_slot: raw.auto_focus_on_slot,
      notification_silent: raw.notification_silent,
      stale_threshold_minutes: Number(raw.stale_threshold_minutes),
      auto_start_on_login: raw.auto_start_on_login,
      group_notifications: raw.group_notifications,
      minimize_after_notification_submit: raw.minimize_after_notification_submit,
      island_os_notifications: raw.island_os_notifications,
      jira_log_on_afstem: raw.jira_log_on_afstem
    };
    try {
      const resp = await this.ipc.saveSettings(payload);
      // Update baseline after successful save for accurate change detection.
      const persisted = resp?.settings ?? payload;
      this.apply(persisted);
      this.initialSettings.set(persisted);
      this.jiraVerifyResults.set({});
      this.verifyAllJiraConnections();
      this.showSaveToast('Indstillinger gemt.', 'success');
      return true;
    } catch {
      // Keep baseline unchanged on failure so user can retry save.
      this.showSaveToast('Gemning fejlede. Prøv igen.', 'error');
      return false;
    }
  }

  private showSaveToast(message: string, kind: 'success' | 'error') {
    this.saveToast.set({ message, kind });
    if (this.saveToastTimer) clearTimeout(this.saveToastTimer);
    this.saveToastTimer = setTimeout(() => {
      this.saveToast.set(null);
      this.saveToastTimer = null;
    }, 2800);
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

  setWorkScheduleMode(mode: WorkScheduleMode) {
    if (mode === 'weekly' && this.workSchedule().every(slots => !slots.length)) {
      const raw = this.settingsForm.getRawValue();
      const mask = this.weekdayControlNames.reduce((acc, name, i) => raw[name] ? acc | (1 << i) : acc, 0);
      this.workSchedule.set(scheduleFromInterval(raw.work_start, raw.work_end, mask));
    }
    this.settingsForm.controls.work_schedule_mode.setValue(mode);
  }

  isSlotSelected(weekday: number, slot: string): boolean {
    return this.scheduleSets()[weekday]?.has(slot) ?? false;
  }

  dayWorkMinutes(weekday: number): number {
    return (this.workSchedule()[weekday]?.length ?? 0) * WORK_SLOT_MINUTES;
  }

  onScheduleSlotClick(event: MouseEvent, weekday: number, slot: string) {
    // Pointer clicks are handled by pointerdown; only keyboard activation (detail 0) toggles here.
    if (event.detail !== 0) return;
    this.setScheduleSlot(weekday, slot, !this.isSlotSelected(weekday, slot));
  }

  startScheduleDrag(event: PointerEvent, weekday: number, slot: string) {
    if (event.button !== 0) return;
    event.preventDefault();
    this.dragActive = true;
    this.dragTargetState = !this.isSlotSelected(weekday, slot);
    this.dragVisited.clear();
    this.paintScheduleSlot(weekday, slot);
    const target = event.currentTarget;
    // Release implicit pointer capture so pointerenter fires on neighbouring slots while dragging.
    queueMicrotask(() => {
      if (target instanceof Element && target.hasPointerCapture(event.pointerId)) {
        target.releasePointerCapture(event.pointerId);
      }
    });
  }

  continueScheduleDrag(weekday: number, slot: string) {
    if (this.dragActive) this.paintScheduleSlot(weekday, slot);
  }

  endScheduleDrag() {
    this.dragActive = false;
    this.dragVisited.clear();
  }

  selectEntireDay(weekday: number) {
    this.updateScheduleDay(weekday, ALL_WORK_SLOT_STARTS);
  }

  clearDay(weekday: number) {
    this.updateScheduleDay(weekday, []);
  }

  private paintScheduleSlot(weekday: number, slot: string) {
    const key = `${weekday}:${slot}`;
    if (this.dragVisited.has(key)) return;
    this.dragVisited.add(key);
    this.setScheduleSlot(weekday, slot, this.dragTargetState);
  }

  private setScheduleSlot(weekday: number, slot: string, active: boolean) {
    const current = new Set(this.workSchedule()[weekday] ?? []);
    if (active) current.add(slot);
    else current.delete(slot);
    this.updateScheduleDay(weekday, Array.from(current).sort());
  }

  private updateScheduleDay(weekday: number, slots: string[]) {
    this.workSchedule.update(schedule =>
      schedule.map((daySlots, index) => index === weekday ? [...slots] : daySlots)
    );
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

  private createJiraConnectionGroup(c: Partial<JiraConnection> = {}): JiraConnectionForm {
    return this.fb.nonNullable.group({
      id: c.id || crypto.randomUUID(),
      name: c.name ?? '',
      type: (c.type === 'cloud' ? 'cloud' : 'server') as JiraDeployment,
      base_url: c.base_url ?? '',
      project_key: c.project_key ?? '',
      token: c.token ?? '',
      email: c.email ?? ''
    });
  }

  addJiraConnection(type: JiraDeployment) {
    const existing = this.jiraConnections.getRawValue();
    const group = this.createJiraConnectionGroup({
      type,
      name: type === 'cloud' ? 'Jira Cloud' : 'Jira On-Premise',
      base_url: type === 'server' ? DEFAULT_ONPREM_JIRA_URL : '',
      project_key: existing[0]?.project_key ?? ''
    });
    this.jiraConnections.push(group);
    if (!this.settingsForm.controls.jira_active_connection_id.value) {
      this.settingsForm.controls.jira_active_connection_id.setValue(group.controls.id.value);
    }
  }

  removeJiraConnection(index: number) {
    const removedId = this.jiraConnections.at(index)?.controls.id.value;
    this.jiraConnections.removeAt(index);
    const activeCtrl = this.settingsForm.controls.jira_active_connection_id;
    if (activeCtrl.value === removedId) {
      activeCtrl.setValue(this.jiraConnections.at(0)?.controls.id.value ?? '');
    }
  }

  isJiraVerifyBusy(id: string): boolean {
    return this.jiraVerifyBusyIds().has(id);
  }

  private verifyAllJiraConnections() {
    for (const c of this.jiraConnections.getRawValue()) {
      if (isJiraConnectionUsable(c)) void this.verifyJiraConnection(c.id);
    }
  }

  async verifyJiraConnection(id: string) {
    const connection = this.jiraConnections.getRawValue().find((c) => c.id === id);
    if (!connection) return;
    if (!isJiraConnectionUsable(connection)) {
      const missing = connection.type === 'cloud' ? 'URL, email og API token' : 'URL og PSA key';
      this.setJiraVerifyResult(id, { ok: false, error: `Udfyld ${missing}.` });
      return;
    }

    this.jiraVerifyBusyIds.update((ids) => new Set(ids).add(id));
    try {
      this.setJiraVerifyResult(id, await this.ipc.verifyJiraIdentity(connection));
    } catch (err) {
      this.setJiraVerifyResult(id, { ok: false, error: String(err) });
    } finally {
      this.jiraVerifyBusyIds.update((ids) => {
        const next = new Set(ids);
        next.delete(id);
        return next;
      });
    }
  }

  private setJiraVerifyResult(id: string, result: JiraIdentityResult) {
    this.jiraVerifyResults.update((all) => ({ ...all, [id]: result }));
  }

  requestLeaveConfirmation(): boolean | Promise<boolean> {
    if (!this.changed()) return true;
    if (this.pendingLeavePromise) return this.pendingLeavePromise;

    this.showUnsavedDialog.set(true);
    this.pendingLeavePromise = new Promise<boolean>((resolve) => {
      this.pendingLeaveResolver = resolve;
    });
    return this.pendingLeavePromise;
  }

  cancelLeave() {
    this.resolvePendingLeave(false);
  }

  discardChangesAndLeave() {
    this.resolvePendingLeave(true);
  }

  async saveChangesAndLeave() {
    if (this.leaveDialogBusy()) return;
    this.leaveDialogBusy.set(true);
    const ok = await this.save();
    this.leaveDialogBusy.set(false);
    if (ok) {
      this.resolvePendingLeave(true);
    }
  }

  ngOnDestroy() {
    if (this.saveToastTimer) {
      clearTimeout(this.saveToastTimer);
      this.saveToastTimer = null;
    }
    if (this.pendingLeaveResolver) {
      this.pendingLeaveResolver(false);
      this.pendingLeaveResolver = null;
      this.pendingLeavePromise = null;
    }
  }

  private resolvePendingLeave(allow: boolean) {
    this.showUnsavedDialog.set(false);
    const resolver = this.pendingLeaveResolver;
    this.pendingLeaveResolver = null;
    this.pendingLeavePromise = null;
    resolver?.(allow);
  }

  onWindowBeforeUnload(event: BeforeUnloadEvent) {
    if (!this.changed()) return;
    event.preventDefault();
    event.returnValue = '';
  }
}
