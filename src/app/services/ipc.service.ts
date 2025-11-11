import { Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';

declare global {
  interface Window {
    workApi: {
      getDayEntries(day: string): Promise<any[]>;
      saveEntries(entries: any[]): Promise<void>;
      getSummary(day: string): Promise<any[]>;
      getDays(): Promise<any[]>;
      getRecent(limit?: number): Promise<any[]>;
  getRecentToday?(limit?: number): Promise<any[]>;
      getPendingSlots(): Promise<string[]>;
      getSettings(): Promise<any>;
      saveSettings(settings: any): Promise<void>;
      submitSlots(payload: { slots: string[], description: string, category: string }): Promise<{ ok: boolean }>;
  deleteEntry(day: string, start: string): Promise<{ ok: boolean, removed?: number }>;
      onPrompt(cb: (d: any) => void): void;
  onFocus(cb: () => void): void;
  onAppReady?: (cb: () => void) => void;
  sendTestNotification?(body?: string): Promise<{ ok: boolean }>;
  onQueueUpdated?(cb: () => void): void;
  // Window controls
  minimizeWindow?(): Promise<{ ok: boolean }>;
  toggleMaximizeWindow?(): Promise<{ ok: boolean, maximized?: boolean }>;
  closeWindow?(): Promise<{ ok: boolean }>;
  onMaximizeState?(cb: (s: { maximized: boolean }) => void): void;
  getExternalLogged?(day: string): Promise<{ day: string; exported: boolean }>;
  setExternalLogged?(day: string, exported: boolean): Promise<{ day: string; exported: boolean }>;
      importExternal?(raw: string): Promise<{ ok: boolean; imported?: number; skipped?: number; details?: { line: number; reason: string }[]; error?: string }>;
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
  lastPromptSlot = signal<string|null>(null);
  windowMaximized = signal<boolean>(false);
  // Flag to indicate next opened log dialog should preselect all pending slots
  bulkSelectAllFlag = signal(false);
  // External exported status map (day -> true if logged externally)
  dayExported = signal<Map<string, boolean>>(new Map());


  constructor() {
    const router = inject(Router);
    window.workApi.onPrompt((d) => {
      if (d && typeof d.slot === 'string') {
        // Set prompt slot immediately
        this.lastPromptSlot.set(d.slot);
        // Optimistically ensure the pendingSlots signal contains the slot so
        // a freshly opened dialog can pre-select it without racing the async load.
        const current = this.pendingSlots();
        if (!current.includes(d.slot)) {
          this.pendingSlots.set([...current, d.slot].sort());
        }
      }
      // Load authoritative list from main process (reconciles optimistic add)
      this.loadPending();
    });
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
      window.workApi.onQueueUpdated?.(() => this.loadPending());
      window.workApi.onMaximizeState?.((s) => this.windowMaximized.set(!!s.maximized));
      // Navigate to today summary when tray menu requests it
      (window.workApi as any).onNavigateToday?.((day: string) => {
        if (day) {
          router.navigate(['/summary', day]);
        }
      });
      // Bulk logging request from tray
      (window.workApi as any).onDialogOpenLogAll?.(() => {
        this.bulkSelectAllFlag.set(true);
      });
    } catch { /* ignore */ }
  }

  refreshDays() {
    window.workApi.getDays().then(list => {
      const exportMap = new Map<string, boolean>();
      for (const d of list) {
        if (d.day) exportMap.set(d.day, !!(d as any).exported);
      }
      this.dayExported.set(exportMap);
      this.days.set(list.map((d: any) => ({ day: d.day, slots: d.slots })));
    });
  }

  getDays(): Promise<any[]> {
    return window.workApi.getDays();
  }
  loadDay(day: string): Promise<void> {
    const entriesP = window.workApi.getDayEntries(day).then(this.dayEntries.set);
    const summaryP = window.workApi.getSummary(day).then(this.summary.set);
    if (window.workApi.getExternalLogged) {
      window.workApi.getExternalLogged(day).then(resp => {
        const m = new Map(this.dayExported()); m.set(day, !!resp.exported); this.dayExported.set(m);
      }).catch(()=>{});
    }
    return Promise.all([entriesP, summaryP]).then(() => {});
  }
  loadRecent() {
    // Prefer today-aware recent if available
    if (window.workApi.getRecentToday) {
      window.workApi.getRecentToday(20).then(this.recent.set);
    } else {
      window.workApi.getRecent(20).then(this.recent.set);
    }
  }
  loadPending() { window.workApi.getPendingSlots().then(this.pendingSlots.set); }
  loadSettings() {
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
        // Refresh pending slots after settings change (interval/hours may alter backlog)
        this.loadPending();
      })
      .catch(err => console.error('[ipc] saveSettings failed', err));
  }


  submitPending(slots: string[], description: string, category: string) {
    return window.workApi.submitSlots({ slots, description, category })
      .then(() => { this.loadPending(); this.refreshDays(); });
  }

  deleteEntry(day: string, start: string) {
    return window.workApi.deleteEntry(day, start)
      .then(() => {
        // Refresh affected signals so UI updates immediately
        this.loadDay(day);
        this.refreshDays();
        this.loadPending(); // slot may have been re-queued if in past
      })
      .catch(err => console.error('[ipc] deleteEntry failed', err));
  }

  // Convenience wrapper for debug notification trigger
  testNotify(body?: string) {
    return window.workApi.sendTestNotification?.(body);
  }

  minimizeWindow() { return window.workApi.minimizeWindow?.(); }
  toggleMaximizeWindow() { return window.workApi.toggleMaximizeWindow?.().then(r => { if (r?.maximized !== undefined) this.windowMaximized.set(!!r.maximized); }); }
  closeWindow() { return window.workApi.closeWindow?.(); }

  // Toggle external logged flag for a day
  setDayExported(day: string, exported: boolean) {
    if (!day || !window.workApi.setExternalLogged) return Promise.resolve();
    return window.workApi.setExternalLogged(day, exported)
      .then(resp => {
        const m = new Map(this.dayExported()); m.set(day, !!resp.exported); this.dayExported.set(m);
        this.refreshDays();
      })
      .catch(err => console.error('[ipc] setDayExported failed', err));
  }

  importExternal(raw: string) {
    if (!window.workApi.importExternal) return Promise.resolve({ ok: false, error: 'Not supported' });
    return window.workApi.importExternal(raw).then(r => {
      // Refresh days & current day entries after import
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth()+1).padStart(2,'0');
      const d = String(today.getDate()).padStart(2,'0');
      const day = `${y}-${m}-${d}`;
      this.loadDay(day);
      this.refreshDays();
      this.loadPending();
      return r;
    });
  }
}
