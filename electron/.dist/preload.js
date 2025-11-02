"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// electron/preload.ts
const electron_1 = require("electron");
electron_1.contextBridge.exposeInMainWorld('workApi', {
    // DB
    getDayEntries: (day) => electron_1.ipcRenderer.invoke('db:get-day', day),
    saveEntries: (entries) => electron_1.ipcRenderer.invoke('db:save-entries', entries),
    getSummary: (day) => electron_1.ipcRenderer.invoke('db:get-summary', day),
    getDays: () => electron_1.ipcRenderer.invoke('db:get-days'),
    getRecent: (limit) => electron_1.ipcRenderer.invoke('db:get-recent', limit),
    getRecentToday: (limit) => electron_1.ipcRenderer.invoke('db:get-recent-today', limit),
    getSettings: () => electron_1.ipcRenderer.invoke('db:get-settings'),
    saveSettings: (s) => electron_1.ipcRenderer.invoke('db:save-settings', s),
    deleteEntry: (day, start) => electron_1.ipcRenderer.invoke('db:delete-entry', day, start),
    // Backlog queue
    getPendingSlots: () => electron_1.ipcRenderer.invoke('queue:get'),
    submitSlots: (payload) => electron_1.ipcRenderer.invoke('queue:submit', payload),
    // Events from main (notifications clicked)
    onPrompt: (cb) => electron_1.ipcRenderer.on('prompt:open', (_e, d) => cb(d)),
    onFocus: (cb) => electron_1.ipcRenderer.on('app:focus', cb),
    onAppReady: (cb) => electron_1.ipcRenderer.once('app:ready', cb),
    // Queue update event (pending slots rebuilt)
    onQueueUpdated: (cb) => electron_1.ipcRenderer.on('queue:updated', cb),
    // Debug notification trigger
    sendTestNotification: (body) => electron_1.ipcRenderer.invoke('debug:notify', { body })
});
//# sourceMappingURL=preload.js.map