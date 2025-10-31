import { Injectable, signal } from '@angular/core';

declare global {
  interface Window {
    workApi: {
      getDayEntries(day: string): Promise<any[]>;
      saveEntries(entries: any[]): Promise<void>;
      getSummary(day: string): Promise<any[]>;
      getDays(): Promise<any[]>;
      getRecent(limit?: number): Promise<any[]>;
      getPendingSlots(): Promise<string[]>;
      getSettings(): Promise<any>;
      saveSettings(settings: any): Promise<void>;
      submitSlots(payload: { slots: string[], description: string, category: string }): Promise<{ ok: boolean }>;
      onPrompt(cb: (d: any) => void): void;
  onFocus(cb: () => void): void;
  onAppReady?: (cb: () => void) => void;
  sendTestNotification?(body?: string): Promise<{ ok: boolean }>;
    }
  }
}

export interface SummaryRow { description: string; category: string; slots: number; minutes: number; }

@Injectable({ providedIn: 'root' })
export class IpcService {
  days = signal<{ day: string; slots: number }[]>([]);
  dayEntries = signal<any[]>([]);
  summary = signal<SummaryRow[]>([]);
  pendingSlots = signal<string[]>([]);
  recent = signal<any[]>([]);
  settings = signal<any|null>(null);


  constructor() {
    window.workApi.onPrompt(() => this.loadPending());
    window.workApi.onFocus(() => this.loadPending());
    this.refreshDays();
    this.loadPending();
    this.loadRecent();
    // Attempt immediate settings load; handlers are registered at module load in main.ts
    this.loadSettings();
    // If optional app ready hook exists (newer preload), use it to re-attempt once
    try {
      window.workApi.onAppReady?.(() => {
        if (!this.settings()) this.loadSettings();
      });
    } catch { /* ignore */ }
  }

  refreshDays() { window.workApi.getDays().then(this.days.set); }

  getDays(): Promise<any[]> {
    return window.workApi.getDays();
  }
  loadDay(day: string): Promise<void> {
    const entriesP = window.workApi.getDayEntries(day).then(this.dayEntries.set);
    const summaryP = window.workApi.getSummary(day).then(this.summary.set);
    return Promise.all([entriesP, summaryP]).then(() => {});
  }
  loadRecent() { window.workApi.getRecent(20).then(this.recent.set); }
  loadPending() { window.workApi.getPendingSlots().then(this.pendingSlots.set); }
  loadSettings() {
    console.log(window.workApi.getSettings());

    window.workApi.getSettings()
      .then(this.settings.set)
      .catch(err => {
        console.error('[ipc] loadSettings failed', err);
        // Retry once after short delay in case handlers were not yet registered
        setTimeout(() => {
          window.workApi.getSettings()
            .then(this.settings.set)
            .catch(e2 => console.error('[ipc] second loadSettings attempt failed', e2));
        }, 500);
      });
  }
  saveSettings(s: any) {
    return window.workApi.saveSettings(s)
      .then((resp: any) => {
        // If main returns updated settings object, prefer that; otherwise reload
        if (resp && resp.settings) this.settings.set(resp.settings);
        else this.loadSettings();
      })
      .catch(err => console.error('[ipc] saveSettings failed', err));
  }

  submitPending(slots: string[], description: string, category: string) {
    return window.workApi.submitSlots({ slots, description, category })
      .then(() => { this.loadPending(); this.refreshDays(); });
  }

  // Convenience wrapper for debug notification trigger
  testNotify(body?: string) {
    return window.workApi.sendTestNotification?.(body);
  }
}
