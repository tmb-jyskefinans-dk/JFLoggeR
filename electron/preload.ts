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
  submitSlots: (payload: { slots: string[], description: string, category: string }) =>
    ipcRenderer.invoke('queue:submit', payload),

  // Events from main (notifications clicked)
  onPrompt: (cb: (d: any) => void) => ipcRenderer.on('prompt:open', (_e, d) => cb(d)),
  onFocus: (cb: () => void) => ipcRenderer.on('app:focus', cb),
  onAppReady: (cb: () => void) => ipcRenderer.once('app:ready', cb),
  // Queue update event (pending slots rebuilt)
  onQueueUpdated: (cb: () => void) => ipcRenderer.on('queue:updated', cb),
  // Navigation events
  onNavigateToday: (cb: (day: string) => void) => ipcRenderer.on('navigate:today', (_e, d: { day: string }) => cb(d.day)),
  onDialogOpenLog: (cb: (slot?: string) => void) => ipcRenderer.on('dialog:open-log', (_e, d: { slot?: string }) => cb(d?.slot)),
  onDialogOpenLogAll: (cb: () => void) => ipcRenderer.on('dialog:open-log-all', () => cb()),
  // Debug notification trigger
  sendTestNotification: (body?: string) => ipcRenderer.invoke('debug:notify', { body })
  ,
  // Window controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:toggle-maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  onMaximizeState: (cb: (state: { maximized: boolean }) => void) => ipcRenderer.on('window:maximize-state', (_e, d) => cb(d))
  ,
  // Logging bridge
  logWrite: (level: string, message: string, meta?: any) => ipcRenderer.invoke('log:write', { level, message, meta })
});
