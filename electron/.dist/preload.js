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
    // External logged status
    getExternalLogged: (day) => electron_1.ipcRenderer.invoke('db:get-external-logged', day),
    setExternalLogged: (day, exported) => electron_1.ipcRenderer.invoke('db:set-external-logged', day, exported),
    // Backlog queue
    getPendingSlots: () => electron_1.ipcRenderer.invoke('queue:get'),
    submitSlots: (payload) => electron_1.ipcRenderer.invoke('queue:submit', payload),
    // Events from main (notifications clicked)
    onPrompt: (cb) => electron_1.ipcRenderer.on('prompt:open', (_e, d) => cb(d)),
    onFocus: (cb) => electron_1.ipcRenderer.on('app:focus', cb),
    onAppReady: (cb) => electron_1.ipcRenderer.once('app:ready', cb),
    // Queue update event (pending slots rebuilt)
    onQueueUpdated: (cb) => electron_1.ipcRenderer.on('queue:updated', cb),
    // Navigation events
    onNavigateToday: (cb) => electron_1.ipcRenderer.on('navigate:today', (_e, d) => cb(d.day)),
    onDialogOpenLog: (cb) => electron_1.ipcRenderer.on('dialog:open-log', (_e, d) => cb(d?.slot)),
    onDialogOpenLogAll: (cb) => electron_1.ipcRenderer.on('dialog:open-log-all', () => cb()),
    // Debug notification trigger
    sendTestNotification: (body) => electron_1.ipcRenderer.invoke('debug:notify', { body }),
    // Window controls
    minimizeWindow: () => electron_1.ipcRenderer.invoke('window:minimize'),
    toggleMaximizeWindow: () => electron_1.ipcRenderer.invoke('window:toggle-maximize'),
    closeWindow: () => electron_1.ipcRenderer.invoke('window:close'),
    onMaximizeState: (cb) => electron_1.ipcRenderer.on('window:maximize-state', (_e, d) => cb(d))
});
//# sourceMappingURL=preload.js.map