"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.initDb = initDb;
exports.getSettings = getSettings;
exports.saveSettings = saveSettings;
exports.saveEntries = saveEntries;
exports.getDayEntries = getDayEntries;
exports.getDays = getDays;
exports.getSummary = getSummary;
exports.getDistinctRecent = getDistinctRecent;
exports.getDistinctRecentToday = getDistinctRecentToday;
exports.ensureDayCreated = ensureDayCreated;
exports.lastNEntries = lastNEntries;
const tslib_1 = require("tslib");
// electron/db.ts
const electron_1 = require("electron");
const path = tslib_1.__importStar(require("node:path"));
const fs = tslib_1.__importStar(require("node:fs"));
const lowdb_1 = require("lowdb");
const node_1 = require("lowdb/node");
const DEFAULT_SETTINGS = {
    work_start: '08:00',
    work_end: '16:00',
    slot_minutes: 15,
    weekdays_mask: 0b0111110, // Mon–Fri
    auto_focus_on_slot: false,
    notification_silent: true
};
let db;
function ensureDb() {
    // Lazy init safeguard in case callers access before main.ts calls initDb()
    if (!db) {
        initDb();
    }
}
function initDb() {
    const dir = electron_1.app.getPath('userData') + "/worklogger";
    if (!fs.existsSync(dir))
        fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, '/worklogger.json');
    console.log("DB file path:", file);
    if (!fs.existsSync(file))
        fs.writeFileSync(file, JSON.stringify({}));
    const seed = { entries: [], settings: DEFAULT_SETTINGS, _seq: 1 };
    // We let the first write via lowdb create the file if missing.
    db = new lowdb_1.LowSync(new node_1.JSONFileSync(file), seed);
    db.read();
    // Ensure shape (and create file on first write if it was missing)
    let changed = false;
    if (!db.data) {
        db.data = seed;
        changed = true;
    }
    if (!db.data.settings) {
        db.data.settings = { ...DEFAULT_SETTINGS };
        changed = true;
    }
    else {
        // ensure new fields
        if (typeof db.data.settings.auto_focus_on_slot !== 'boolean') {
            db.data.settings.auto_focus_on_slot = DEFAULT_SETTINGS.auto_focus_on_slot;
            changed = true;
        }
        if (typeof db.data.settings.notification_silent !== 'boolean') {
            db.data.settings.notification_silent = DEFAULT_SETTINGS.notification_silent;
            changed = true;
        }
    }
    if (typeof db.data._seq !== 'number') {
        db.data._seq = 1;
        changed = true;
    }
    if (!Array.isArray(db.data.entries)) {
        db.data.entries = [];
        changed = true;
    }
    if (changed)
        db.write();
}
/** SETTINGS */
function getSettings() {
    ensureDb();
    db.read();
    return db.data.settings;
}
function saveSettings(s) {
    ensureDb();
    db.read();
    db.data.settings = {
        work_start: s.work_start,
        work_end: s.work_end,
        slot_minutes: Number(s.slot_minutes) || 15,
        weekdays_mask: Number(s.weekdays_mask) >>> 0,
        auto_focus_on_slot: !!s.auto_focus_on_slot,
        notification_silent: !!s.notification_silent
    };
    db.write();
}
/** ENTRIES - core helpers */
function entryKey(e) {
    return `${e.day}T${e.start}`;
}
function saveEntries(entries) {
    ensureDb();
    db.read();
    const nowISO = new Date().toISOString();
    // Build a map of existing entries by (day,start)
    const existing = new Map();
    for (const e of db.data.entries) {
        existing.set(entryKey(e), e);
    }
    for (const raw of entries) {
        const e = {
            ...raw,
            created_at: raw.created_at ?? nowISO
        };
        existing.set(entryKey(e), e);
    }
    db.data.entries = Array.from(existing.values())
        .sort((a, b) => (a.day === b.day ? a.start.localeCompare(b.start) : a.day.localeCompare(b.day)));
    db.write();
}
function getDayEntries(day) {
    ensureDb();
    db.read();
    return db.data.entries
        .filter(e => e.day === day)
        .sort((a, b) => a.start.localeCompare(b.start));
}
function getDays() {
    ensureDb();
    db.read();
    const counts = new Map();
    for (const e of db.data.entries) {
        counts.set(e.day, (counts.get(e.day) ?? 0) + 1);
    }
    return Array.from(counts.entries())
        .map(([day, slots]) => ({ day, slots }))
        .sort((a, b) => b.day.localeCompare(a.day));
}
function getSummary(day) {
    ensureDb();
    db.read();
    const s = getSettings();
    const entries = db.data.entries.filter(e => e.day === day);
    const grouped = new Map();
    for (const e of entries) {
        const key = `${e.description}||${e.category}`;
        if (!grouped.has(key))
            grouped.set(key, { description: e.description, category: e.category, slots: 0 });
        grouped.get(key).slots++;
    }
    return Array.from(grouped.values())
        .map(g => ({ ...g, minutes: g.slots * s.slot_minutes }))
        .sort((a, b) => b.minutes - a.minutes || a.description.localeCompare(b.description));
}
function getDistinctRecent(limit = 20) {
    ensureDb();
    db.read();
    const grouped = new Map();
    for (const e of db.data.entries) {
        const key = `${e.description}||${e.category}`;
        if (!grouped.has(key)) {
            grouped.set(key, { description: e.description, category: e.category, uses: 0, last_used: e.created_at ?? '' });
        }
        const g = grouped.get(key);
        g.uses++;
        if (e.created_at && (!g.last_used || e.created_at > g.last_used))
            g.last_used = e.created_at;
    }
    return Array.from(grouped.values())
        .sort((a, b) => b.last_used.localeCompare(a.last_used))
        .slice(0, limit);
}
// Variant that also reports how many times an item was used today (local date)
function getDistinctRecentToday(limit = 20) {
    ensureDb();
    db.read();
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayKey = `${y}-${m}-${d}`;
    const grouped = new Map();
    for (const e of db.data.entries) {
        const key = `${e.description}||${e.category}`;
        if (!grouped.has(key)) {
            grouped.set(key, { description: e.description, category: e.category, uses: 0, uses_today: 0, last_used: e.created_at ?? '' });
        }
        const g = grouped.get(key);
        g.uses++;
        if (e.day === todayKey)
            g.uses_today++;
        if (e.created_at && (!g.last_used || e.created_at > g.last_used))
            g.last_used = e.created_at;
    }
    return Array.from(grouped.values())
        .sort((a, b) => b.last_used.localeCompare(a.last_used))
        .slice(0, limit);
}
/** Convenience (kept for API parity) */
function ensureDayCreated(day) { return day; }
function lastNEntries(n = 8) {
    ensureDb();
    db.read();
    return [...db.data.entries]
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))
        .slice(0, n);
}
//# sourceMappingURL=db.js.map