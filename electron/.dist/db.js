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
exports.deleteEntry = deleteEntry;
exports.getExternalLogged = getExternalLogged;
exports.setExternalLogged = setExternalLogged;
exports.getJiraLoggedWorklogs = getJiraLoggedWorklogs;
exports.setJiraLoggedWorklogs = setJiraLoggedWorklogs;
exports.clearJiraLoggedWorklogs = clearJiraLoggedWorklogs;
exports.ensureDayCreated = ensureDayCreated;
exports.lastNEntries = lastNEntries;
exports.importExternalLines = importExternalLines;
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
    include_active_slot: false,
    azure_tenant_id: '',
    azure_client_id: '',
    auto_focus_on_slot: false,
    notification_silent: true,
    stale_threshold_minutes: 45,
    auto_start_on_login: false,
    group_notifications: true,
    minimize_after_notification_submit: false,
    jira_psa_key: '',
    jira_project_key: '',
    jira_log_on_afstem: false
};
let db;
function sanitizeSlotMinutes(value) {
    const parsed = Math.trunc(Number(value));
    if (!Number.isFinite(parsed) || parsed <= 0)
        return DEFAULT_SETTINGS.slot_minutes;
    return parsed;
}
function ensureDb() {
    // Lazy init safeguard in case callers access before main.ts calls initDb()
    if (!db) {
        initDb();
    }
}
function initDb() {
    const dir = electron_1.app.getPath('userData');
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
        if (sanitizeSlotMinutes(db.data.settings.slot_minutes) !== db.data.settings.slot_minutes) {
            db.data.settings.slot_minutes = sanitizeSlotMinutes(db.data.settings.slot_minutes);
            changed = true;
        }
        // ensure new fields
        if (db.data.settings.include_active_slot !== false) {
            db.data.settings.include_active_slot = false;
            changed = true;
        }
        if (typeof db.data.settings.azure_tenant_id !== 'string') {
            db.data.settings.azure_tenant_id = DEFAULT_SETTINGS.azure_tenant_id;
            changed = true;
        }
        if (typeof db.data.settings.azure_client_id !== 'string') {
            db.data.settings.azure_client_id = DEFAULT_SETTINGS.azure_client_id;
            changed = true;
        }
        if (typeof db.data.settings.auto_focus_on_slot !== 'boolean') {
            db.data.settings.auto_focus_on_slot = DEFAULT_SETTINGS.auto_focus_on_slot;
            changed = true;
        }
        if (typeof db.data.settings.notification_silent !== 'boolean') {
            db.data.settings.notification_silent = DEFAULT_SETTINGS.notification_silent;
            changed = true;
        }
        if (typeof db.data.settings.stale_threshold_minutes !== 'number') {
            db.data.settings.stale_threshold_minutes = DEFAULT_SETTINGS.stale_threshold_minutes;
            changed = true;
        }
        if (typeof db.data.settings.auto_start_on_login !== 'boolean') {
            db.data.settings.auto_start_on_login = DEFAULT_SETTINGS.auto_start_on_login;
            changed = true;
        }
        if (typeof db.data.settings.group_notifications !== 'boolean') {
            db.data.settings.group_notifications = DEFAULT_SETTINGS.group_notifications;
            changed = true;
        }
        if (typeof db.data.settings.minimize_after_notification_submit !== 'boolean') {
            db.data.settings.minimize_after_notification_submit = DEFAULT_SETTINGS.minimize_after_notification_submit;
            changed = true;
        }
        if (typeof db.data.settings.jira_psa_key !== 'string') {
            db.data.settings.jira_psa_key = DEFAULT_SETTINGS.jira_psa_key;
            changed = true;
        }
        if (typeof db.data.settings.jira_project_key !== 'string') {
            db.data.settings.jira_project_key = DEFAULT_SETTINGS.jira_project_key;
            changed = true;
        }
        if (typeof db.data.settings.jira_log_on_afstem !== 'boolean') {
            db.data.settings.jira_log_on_afstem = DEFAULT_SETTINGS.jira_log_on_afstem;
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
    if (!db.data.external_logged || typeof db.data.external_logged !== 'object') {
        db.data.external_logged = {};
        changed = true;
    }
    if (!db.data.jira_logged_worklogs || typeof db.data.jira_logged_worklogs !== 'object') {
        db.data.jira_logged_worklogs = {};
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
        slot_minutes: sanitizeSlotMinutes(s.slot_minutes),
        weekdays_mask: Number(s.weekdays_mask) >>> 0,
        include_active_slot: false,
        azure_tenant_id: String(s.azure_tenant_id ?? '').trim(),
        azure_client_id: String(s.azure_client_id ?? '').trim(),
        auto_focus_on_slot: !!s.auto_focus_on_slot,
        notification_silent: !!s.notification_silent,
        stale_threshold_minutes: Number(s.stale_threshold_minutes) || DEFAULT_SETTINGS.stale_threshold_minutes,
        auto_start_on_login: !!s.auto_start_on_login,
        group_notifications: !!s.group_notifications,
        minimize_after_notification_submit: !!s.minimize_after_notification_submit,
        jira_psa_key: String(s.jira_psa_key ?? '').trim(),
        jira_project_key: String(s.jira_project_key ?? '').trim().toUpperCase(),
        jira_log_on_afstem: !!s.jira_log_on_afstem
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
        .map(([day, slots]) => ({ day, slots, exported: !!db.data.external_logged?.[day] }))
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
// Suggest a category for a given description based on historical usage excluding 'Andet'
// Category suggestion feature removed.
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
/** Delete a single entry by (day,start). Returns number of removed entries. */
function deleteEntry(day, start) {
    ensureDb();
    db.read();
    const before = db.data.entries.length;
    db.data.entries = db.data.entries.filter(e => !(e.day === day && e.start === start));
    if (db.data.entries.length !== before) {
        db.write();
        return 1;
    }
    return 0;
}
/** External logged status helpers */
function getExternalLogged(day) {
    ensureDb();
    db.read();
    return !!db.data.external_logged?.[day];
}
function setExternalLogged(day, val) {
    ensureDb();
    db.read();
    if (!db.data.external_logged)
        db.data.external_logged = {};
    db.data.external_logged[day] = !!val;
    db.write();
    return { day, exported: !!val };
}
function getJiraLoggedWorklogs(day) {
    ensureDb();
    db.read();
    const rows = db.data.jira_logged_worklogs?.[day];
    if (!Array.isArray(rows))
        return [];
    return rows
        .filter((r) => !!r && typeof r.key === 'string' && typeof r.worklogId === 'string')
        .map((r) => ({
        key: String(r.key).trim().toUpperCase(),
        worklogId: String(r.worklogId).trim(),
        seconds: Number(r.seconds) || 0,
        started: typeof r.started === 'string' ? r.started : undefined,
        logged_at: typeof r.logged_at === 'string' ? r.logged_at : undefined
    }))
        .filter((r) => !!r.key && !!r.worklogId);
}
function setJiraLoggedWorklogs(day, worklogs) {
    ensureDb();
    db.read();
    if (!db.data.jira_logged_worklogs)
        db.data.jira_logged_worklogs = {};
    const normalized = (worklogs ?? [])
        .filter((r) => !!r && typeof r.key === 'string' && typeof r.worklogId === 'string')
        .map((r) => ({
        key: String(r.key).trim().toUpperCase(),
        worklogId: String(r.worklogId).trim(),
        seconds: Number(r.seconds) || 0,
        started: typeof r.started === 'string' ? r.started : undefined,
        logged_at: typeof r.logged_at === 'string' ? r.logged_at : new Date().toISOString()
    }))
        .filter((r) => !!r.key && !!r.worklogId);
    db.data.jira_logged_worklogs[day] = normalized;
    db.write();
    return normalized;
}
function clearJiraLoggedWorklogs(day) {
    ensureDb();
    db.read();
    if (!db.data.jira_logged_worklogs)
        db.data.jira_logged_worklogs = {};
    delete db.data.jira_logged_worklogs[day];
    db.write();
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
/** Import external JSON lines describing time segments.
 * Format per line now supports an optional category field:
 * {"entry_id":"uuid","task":"Desc","segment_start":"2025-11-11T08:41:00","segment_end":"2025-11-11T08:56:00","minutes":15,"category":"Andet"}
 * Each record is expanded into slot-sized entries (current settings.slot_minutes) fully contained in the interval.
 * Partial leading/trailing fragments shorter than the slot size are ignored.
 * Category fallbacks: if category missing -> 'Import'; blank string trimmed; special case 'Andet' preserved.
 */
function importExternalLines(raw) {
    ensureDb();
    db.read();
    const slotMinutes = sanitizeSlotMinutes(getSettings().slot_minutes); // dynamic granularity
    const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
    const imported = [];
    const details = [];
    let skipped = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let importedForLine = 0;
        let obj;
        try {
            obj = JSON.parse(line);
        }
        catch (e) {
            skipped++;
            details.push({ line: i + 1, reason: 'Invalid JSON' });
            continue;
        }
        const { task, segment_start, segment_end, category } = obj || {};
        if (!task || !segment_start || !segment_end) {
            skipped++;
            details.push({ line: i + 1, reason: 'Missing required field task/segment_start/segment_end' });
            continue;
        }
        let startDate, endDate;
        try {
            startDate = new Date(segment_start);
            endDate = new Date(segment_end);
        }
        catch {
            skipped++;
            details.push({ line: i + 1, reason: 'Invalid date format' });
            continue;
        }
        if (!(startDate instanceof Date) || isNaN(startDate.getTime()) || !(endDate instanceof Date) || isNaN(endDate.getTime())) {
            skipped++;
            details.push({ line: i + 1, reason: 'Unparseable dates' });
            continue;
        }
        if (endDate <= startDate) {
            skipped++;
            details.push({ line: i + 1, reason: 'End before start' });
            continue;
        }
        // Expand into slot-sized entries fully contained in interval
        const intervalMinutes = (endDate.getTime() - startDate.getTime()) / 60000;
        // Floor first slot start to boundary
        const first = new Date(startDate);
        const boundaryMinutes = Math.floor(first.getMinutes() / slotMinutes) * slotMinutes;
        first.setMinutes(boundaryMinutes, 0, 0);
        for (let cursor = first; cursor < endDate;) {
            const slotEnd = new Date(cursor.getTime() + slotMinutes * 60000);
            if (slotEnd > endDate)
                break; // only include fully-covered slots
            const day = `${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}-${String(cursor.getDate()).padStart(2, '0')}`;
            const startHM = `${String(cursor.getHours()).padStart(2, '0')}:${String(cursor.getMinutes()).padStart(2, '0')}`;
            const endHM = `${String(slotEnd.getHours()).padStart(2, '0')}:${String(slotEnd.getMinutes()).padStart(2, '0')}`;
            const catRaw = typeof category === 'string' ? category.trim() : '';
            const cat = catRaw || 'Import';
            imported.push({ day, start: startHM, end: endHM, description: String(task), category: cat, created_at: new Date().toISOString() });
            importedForLine++;
            cursor = slotEnd;
        }
        if (importedForLine === 0) {
            // Line parsed but did not contain a full slot interval.
            const reason = intervalMinutes < slotMinutes
                ? 'Interval shorter than slot granularity – ignored'
                : 'No full slot intervals found within segment – ignored';
            details.push({ line: i + 1, reason });
            skipped++;
        }
    }
    if (imported.length) {
        saveEntries(imported);
    }
    return { imported: imported.length, skipped, details };
}
//# sourceMappingURL=db.js.map