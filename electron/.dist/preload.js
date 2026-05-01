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
    importExternal: (raw) => electron_1.ipcRenderer.invoke('db:import-external', raw),
    // Backlog queue
    getPendingSlots: () => electron_1.ipcRenderer.invoke('queue:get'),
    submitSlots: (payload) => electron_1.ipcRenderer.invoke('queue:submit', payload),
    // Azure auth
    getAuthStatus: () => electron_1.ipcRenderer.invoke('auth:get-status'),
    signInMicrosoft: () => electron_1.ipcRenderer.invoke('auth:signin'),
    signOutMicrosoft: () => electron_1.ipcRenderer.invoke('auth:signout'),
    // Events from main (notifications clicked)
    onPrompt: (cb) => {
        const handler = (_e, d) => cb(d);
        electron_1.ipcRenderer.on('prompt:open', handler);
        return () => electron_1.ipcRenderer.removeListener('prompt:open', handler);
    },
    onFocus: (cb) => {
        const handler = () => cb();
        electron_1.ipcRenderer.on('app:focus', handler);
        return () => electron_1.ipcRenderer.removeListener('app:focus', handler);
    },
    onAppReady: (cb) => {
        const handler = () => cb();
        electron_1.ipcRenderer.once('app:ready', handler);
        return () => electron_1.ipcRenderer.removeListener('app:ready', handler);
    },
    // Queue update event (pending slots rebuilt)
    onQueueUpdated: (cb) => {
        const handler = () => cb();
        electron_1.ipcRenderer.on('queue:updated', handler);
        return () => electron_1.ipcRenderer.removeListener('queue:updated', handler);
    },
    // Navigation events
    onNavigateToday: (cb) => {
        const handler = (_e, d) => cb(d.day);
        electron_1.ipcRenderer.on('navigate:today', handler);
        return () => electron_1.ipcRenderer.removeListener('navigate:today', handler);
    },
    onDialogOpenLog: (cb) => {
        const handler = (_e, d) => cb(d ?? {});
        electron_1.ipcRenderer.on('dialog:open-log', handler);
        return () => electron_1.ipcRenderer.removeListener('dialog:open-log', handler);
    },
    onDialogOpenLogAll: (cb) => {
        const handler = () => cb();
        electron_1.ipcRenderer.on('dialog:open-log-all', handler);
        return () => electron_1.ipcRenderer.removeListener('dialog:open-log-all', handler);
    },
    // Debug notification trigger
    sendTestNotification: (body) => electron_1.ipcRenderer.invoke('debug:notify', { body }),
    // Window controls
    minimizeWindow: () => electron_1.ipcRenderer.invoke('window:minimize'),
    toggleMaximizeWindow: () => electron_1.ipcRenderer.invoke('window:toggle-maximize'),
    closeWindow: () => electron_1.ipcRenderer.invoke('window:close'),
    onMaximizeState: (cb) => {
        const handler = (_e, d) => cb(d);
        electron_1.ipcRenderer.on('window:maximize-state', handler);
        return () => electron_1.ipcRenderer.removeListener('window:maximize-state', handler);
    },
    // Logging bridge
    logWrite: (level, message, meta) => electron_1.ipcRenderer.invoke('log:write', { level, message, meta })
});
//# sourceMappingURL=preload.js.map