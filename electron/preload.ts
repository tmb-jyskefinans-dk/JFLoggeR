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
  // Debug notification trigger
  sendTestNotification: (body?: string) => ipcRenderer.invoke('debug:notify', { body })
});
