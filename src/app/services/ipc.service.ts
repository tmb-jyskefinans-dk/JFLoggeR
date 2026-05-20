import { Injectable, signal, inject } from '@angular/core';
import { Router } from '@angular/router';

export interface SummaryRow { description: string; category: string; slots: number; minutes: number; }
export interface AuthStatus {
  configured: boolean;
  signedIn: boolean;
  method: 'device-code';
  username?: string;
  name?: string;
  tenantId?: string;
  clientId?: string;
  error?: string;
}

export interface JiraIssueSuggestion {
  key: string;
  summary: string;
  iconUrl: string;
}

export interface JiraWorklogEntry {
  key: string;
  seconds: number;
  success: boolean;
  error?: string;
}

export interface JiraWorklogResult {
  ok: boolean;
  results?: JiraWorklogEntry[];
  error?: string;
}

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
      submitSlots(payload: { slots: string[]; description: string; category: string; minimizeWindowAfterSubmit?: boolean }): Promise<{ ok: boolean; error?: string }>;
      deleteEntry(day: string, start: string): Promise<{ ok: boolean; removed?: number; error?: string }>;
      onPrompt(cb: (d: { slot?: string; source?: string }) => void): (() => void) | void;
      onFocus(cb: () => void): (() => void) | void;
      onAppReady?: (cb: () => void) => (() => void) | void;
      sendTestNotification?(body?: string): Promise<{ ok: boolean }>;
      onQueueUpdated?(cb: () => void): (() => void) | void;
      minimizeWindow?(): Promise<{ ok: boolean }>;
      toggleMaximizeWindow?(): Promise<{ ok: boolean; maximized?: boolean }>;
      closeWindow?(): Promise<{ ok: boolean }>;
      onMaximizeState?(cb: (s: { maximized: boolean }) => void): (() => void) | void;
      getExternalLogged?(day: string): Promise<{ day: string; exported: boolean }>;
      setExternalLogged?(day: string, exported: boolean): Promise<{ day: string; exported: boolean }>;
      importExternal?(raw: string): Promise<{ ok: boolean; imported?: number; skipped?: number; details?: { line: number; reason: string }[]; error?: string }>;
      getAuthStatus?(): Promise<AuthStatus>;
      signInMicrosoft?(): Promise<{ ok: boolean; error?: string; status?: AuthStatus }>;
      signOutMicrosoft?(): Promise<{ ok: boolean; error?: string; status?: AuthStatus }>;
      jiraSearchIssues?(term: string): Promise<{ ok: boolean; items?: JiraIssueSuggestion[]; error?: string }>;
      jiraLogWorklog?(day: string): Promise<JiraWorklogResult>;
    };
  }
}

@Injectable({ providedIn: 'root' })
export class IpcService {
  days = signal<{ day: string; slots: number }[]>([]);
  dayEntries = signal<any[]>([]);
  summary = signal<SummaryRow[]>([]);
  pendingSlots = signal<string[]>([]);
  pendingLastLoadedAt = signal<number | null>(null);
  recent = signal<any[]>([]);
  settings = signal<any | null>(null);
  authStatus = signal<AuthStatus>({ configured: false, signedIn: false, method: 'device-code' });
  lastPromptSlot = signal<string | null>(null);
  lastPromptSource = signal<string | null>(null);
  preselectedSlots = signal<string[] | null>(null);
  windowMaximized = signal<boolean>(false);
  bulkSelectAllFlag = signal(false);
  dayExported = signal<Map<string, boolean>>(new Map());
  private latestLoadDayRequest = 0;

  constructor() {
    const router = inject(Router);
    window.workApi.onPrompt((d) => {
      this.lastPromptSource.set(typeof d?.source === 'string' ? d.source : null);
      if (d && typeof d.slot === 'string') {
        this.lastPromptSlot.set(d.slot);
        const current = this.pendingSlots();
        if (!current.includes(d.slot)) this.pendingSlots.set([...current, d.slot].sort());
      }
      this.loadPending();
    });
    window.workApi.onFocus(() => this.loadPending());
    this.refreshDays();
    this.loadPending();
    this.loadRecent();
    this.loadSettings();
    this.loadAuthStatus();
    try {
      window.workApi.onAppReady?.(() => {
        if (!this.settings()) this.loadSettings();
      });
      window.workApi.onQueueUpdated?.(() => this.loadPending());
      window.workApi.onMaximizeState?.((s) => this.windowMaximized.set(!!s.maximized));
      (window.workApi as any).onNavigateToday?.((day: string) => {
        if (day) router.navigate(['/summary', day]);
      });
      (window.workApi as any).onDialogOpenLogAll?.(() => {
        this.bulkSelectAllFlag.set(true);
      });
    } catch {
      // ignore optional hooks
    }
  }

  refreshDays() {
    window.workApi.getDays().then((list) => {
      const exportMap = new Map<string, boolean>();
      for (const d of list) {
        if (d.day) exportMap.set(d.day, !!(d as any).exported);
      }
      this.dayExported.set(exportMap);
      this.days.set(list.map((d: any) => ({ day: d.day, slots: d.slots })));
    }).catch((err) => {
      console.error('[ipc] refreshDays failed', err);
      this.days.set([]);
      this.dayExported.set(new Map());
    });
  }

  getDays(): Promise<any[]> {
    return window.workApi.getDays();
  }

  loadDay(day: string): Promise<void> {
    const requestId = ++this.latestLoadDayRequest;
    const isCurrent = () => requestId === this.latestLoadDayRequest;
    const entriesP = window.workApi.getDayEntries(day)
      .then((entries) => {
        if (isCurrent()) this.dayEntries.set(entries);
      })
      .catch((err) => {
        console.error('[ipc] loadDay entries failed', { day, err });
        if (isCurrent()) this.dayEntries.set([]);
      });
    const summaryP = window.workApi.getSummary(day)
      .then((summary) => {
        if (isCurrent()) this.summary.set(summary);
      })
      .catch((err) => {
        console.error('[ipc] loadDay summary failed', { day, err });
        if (isCurrent()) this.summary.set([]);
      });
    if (window.workApi.getExternalLogged) {
      window.workApi.getExternalLogged(day).then((resp) => {
        if (!isCurrent()) return;
        const m = new Map(this.dayExported());
        m.set(day, !!resp.exported);
        this.dayExported.set(m);
      }).catch((err) => {
        console.error('[ipc] loadDay external logged failed', { day, err });
      });
    }
    return Promise.all([entriesP, summaryP]).then(() => {});
  }

  loadRecent() {
    if (window.workApi.getRecentToday) {
      window.workApi.getRecentToday(20)
        .then(this.recent.set)
        .catch((err) => {
          console.error('[ipc] loadRecent today failed', err);
          this.recent.set([]);
        });
    } else {
      window.workApi.getRecent(20)
        .then(this.recent.set)
        .catch((err) => {
          console.error('[ipc] loadRecent failed', err);
          this.recent.set([]);
        });
    }
  }

  loadPending() {
    window.workApi.getPendingSlots().then((list) => {
      this.pendingSlots.set(list);
      this.pendingLastLoadedAt.set(Date.now());
    }).catch((err) => {
      console.error('[ipc] loadPending failed', err);
      this.pendingSlots.set([]);
      this.pendingLastLoadedAt.set(Date.now());
    });
  }

  loadSettings() {
    window.workApi.getSettings()
      .then(this.settings.set)
      .catch((err) => {
        console.error('[ipc] loadSettings failed', err);
        setTimeout(() => {
          window.workApi.getSettings()
            .then(this.settings.set)
            .catch((e2) => console.error('[ipc] second loadSettings attempt failed', e2));
        }, 500);
      });
  }

  saveSettings(s: any) {
    return window.workApi.saveSettings(s)
      .then((resp: any) => {
        if (resp && resp.settings) this.settings.set(resp.settings);
        else this.loadSettings();
        this.loadPending();
        return resp;
      })
      .catch((err) => {
        console.error('[ipc] saveSettings failed', err);
        throw err;
      });
  }

  loadAuthStatus() {
    return window.workApi.getAuthStatus?.()
      .then((status) => {
        if (status) this.authStatus.set(status);
        return status;
      })
      .catch((err) => {
        console.error('[ipc] loadAuthStatus failed', err);
        return undefined;
      });
  }

  signInMicrosoft() {
    return window.workApi.signInMicrosoft?.()
      .then((resp) => {
        if (resp?.status) this.authStatus.set(resp.status);
        return resp;
      })
      .catch((err) => {
        console.error('[ipc] signInMicrosoft failed', err);
        throw err;
      });
  }

  signOutMicrosoft() {
    return window.workApi.signOutMicrosoft?.()
      .then((resp) => {
        if (resp?.status) this.authStatus.set(resp.status);
        return resp;
      })
      .catch((err) => {
        console.error('[ipc] signOutMicrosoft failed', err);
        throw err;
      });
  }

  submitPending(slots: string[], description: string, category: string, opts?: { minimizeWindowAfterSubmit?: boolean }) {
    return window.workApi.submitSlots({ slots, description, category, minimizeWindowAfterSubmit: !!opts?.minimizeWindowAfterSubmit })
      .then((resp) => {
        if (!resp?.ok) throw new Error(resp?.error || 'submitPending failed');
        this.loadPending();
        this.refreshDays();
      });
  }

  deleteEntry(day: string, start: string) {
    return window.workApi.deleteEntry(day, start)
      .then((resp) => {
        if (!resp?.ok) throw new Error(resp?.error || 'deleteEntry failed');
        this.loadDay(day);
        this.refreshDays();
        this.loadPending();
      })
      .catch((err) => {
        console.error('[ipc] deleteEntry failed', err);
        throw err;
      });
  }

  testNotify(body?: string) {
    return window.workApi.sendTestNotification?.(body);
  }

  minimizeWindow() { return window.workApi.minimizeWindow?.(); }
  toggleMaximizeWindow() {
    return window.workApi.toggleMaximizeWindow?.().then((r) => {
      if (r?.maximized !== undefined) this.windowMaximized.set(!!r.maximized);
    });
  }
  closeWindow() { return window.workApi.closeWindow?.(); }

  setDayExported(day: string, exported: boolean) {
    if (!day || !window.workApi.setExternalLogged) return Promise.resolve();
    return window.workApi.setExternalLogged(day, exported)
      .then((resp) => {
        const m = new Map(this.dayExported());
        m.set(day, !!resp.exported);
        this.dayExported.set(m);
        this.refreshDays();
      })
      .catch((err) => {
        console.error('[ipc] setDayExported failed', err);
        throw err;
      });
  }

  importExternal(raw: string) {
    if (!window.workApi.importExternal) return Promise.resolve({ ok: false, error: 'Not supported' });
    return window.workApi.importExternal(raw).then((r) => {
      const today = new Date();
      const y = today.getFullYear();
      const m = String(today.getMonth() + 1).padStart(2, '0');
      const d = String(today.getDate()).padStart(2, '0');
      const day = `${y}-${m}-${d}`;
      this.loadDay(day);
      this.refreshDays();
      this.loadPending();
      return r;
    }).catch((err) => {
      console.error('[ipc] importExternal failed', err);
      throw err;
    });
  }

  searchJiraIssues(term: string) {
    if (!window.workApi.jiraSearchIssues) {
      return Promise.resolve({ ok: false, items: [] as JiraIssueSuggestion[], error: 'Jira søgning er ikke tilgængelig.' });
    }
    return window.workApi.jiraSearchIssues(term)
      .then((resp) => ({ ok: !!resp?.ok, items: resp?.items ?? [], error: resp?.error }))
      .catch((err) => {
        console.error('[ipc] searchJiraIssues failed', err);
        return { ok: false, items: [] as JiraIssueSuggestion[], error: 'Jira søgning fejlede.' };
      });
  }

  logWorkToJira(day: string): Promise<JiraWorklogResult> {
    if (!window.workApi.jiraLogWorklog) {
      return Promise.resolve({ ok: false, error: 'Jira worklog er ikke tilgængelig.' });
    }
    return window.workApi.jiraLogWorklog(day)
      .catch((err) => {
        console.error('[ipc] logWorkToJira failed', err);
        return { ok: false, error: 'Jira worklog fejlede.' } as JiraWorklogResult;
      });
  }
}
