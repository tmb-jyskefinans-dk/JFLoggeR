// electron/preload.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('workApi', {
  // DB
  getDayEntries: (day: string) => ipcRenderer.invoke('db:get-day', day),
  saveEntries: (entries: any[]) => ipcRenderer.invoke('db:save-entries', entries),
  getSummary: (day: string) => ipcRenderer.invoke('db:get-summary', day),
  getDays: () => ipcRenderer.invoke('db:get-days'),
  getRecent: (limit?: number) => ipcRenderer.invoke('db:get-recent', limit),
  getRecentToday: (limit?: number) => ipcRenderer.invoke('db:get-recent-today', limit),
  getSettings: () => ipcRenderer.invoke('db:get-settings'),
  saveSettings: (s: any) => ipcRenderer.invoke('db:save-settings', s),
  deleteEntry: (day: string, start: string) => ipcRenderer.invoke('db:delete-entry', day, start),
  // External logged status
  getExternalLogged: (day: string) => ipcRenderer.invoke('db:get-external-logged', day),
  setExternalLogged: (day: string, exported: boolean) => ipcRenderer.invoke('db:set-external-logged', day, exported),
  importExternal: (raw: string) => ipcRenderer.invoke('db:import-external', raw),

  // Backlog queue
  getPendingSlots: () => ipcRenderer.invoke('queue:get'),
  submitSlots: (payload: { slots: string[], description: string, category: string, minimizeWindowAfterSubmit?: boolean }) =>
    ipcRenderer.invoke('queue:submit', payload),

  // Azure auth
  getAuthStatus: () => ipcRenderer.invoke('auth:get-status'),
  signInMicrosoft: () => ipcRenderer.invoke('auth:signin'),
  signOutMicrosoft: () => ipcRenderer.invoke('auth:signout'),
  jiraSearchIssues: (term: string) => ipcRenderer.invoke('jira:search-issues', { term }),
  jiraLogWorklog: (day: string) => ipcRenderer.invoke('jira:log-worklog', { day }),
  jiraVerifyIdentity: (payload?: { psaKey?: string }) => ipcRenderer.invoke('jira:verify-identity', payload ?? {}),

  // Events from main (notifications clicked)
  onPrompt: (cb: (d: any) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: any) => cb(d);
    ipcRenderer.on('prompt:open', handler);
    return () => ipcRenderer.removeListener('prompt:open', handler);
  },
  onFocus: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('app:focus', handler);
    return () => ipcRenderer.removeListener('app:focus', handler);
  },
  onAppReady: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.once('app:ready', handler);
    return () => ipcRenderer.removeListener('app:ready', handler);
  },
  // Queue update event (pending slots rebuilt)
  onQueueUpdated: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('queue:updated', handler);
    return () => ipcRenderer.removeListener('queue:updated', handler);
  },
  // Navigation events
  onNavigateToday: (cb: (day: string) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: { day: string }) => cb(d.day);
    ipcRenderer.on('navigate:today', handler);
    return () => ipcRenderer.removeListener('navigate:today', handler);
  },
  onDialogOpenLog: (cb: (d: { slot?: string; source?: string }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: { slot?: string; source?: string }) => cb(d ?? {});
    ipcRenderer.on('dialog:open-log', handler);
    return () => ipcRenderer.removeListener('dialog:open-log', handler);
  },
  onDialogOpenLogAll: (cb: () => void) => {
    const handler = () => cb();
    ipcRenderer.on('dialog:open-log-all', handler);
    return () => ipcRenderer.removeListener('dialog:open-log-all', handler);
  },
  // Debug notification trigger
  sendTestNotification: (body?: string) => ipcRenderer.invoke('debug:notify', { body })
  ,
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onMaximizeState: (cb: (state: { maximized: boolean }) => void) => {
    const handler = (_e: Electron.IpcRendererEvent, d: { maximized: boolean }) => cb(d);
    ipcRenderer.on('window:maximize-state', handler);
    return () => ipcRenderer.removeListener('window:maximize-state', handler);
  }
  ,
  // Logging bridge
  logWrite: (level: string, message: string, meta?: any) => ipcRenderer.invoke('log:write', { level, message, meta })
});
