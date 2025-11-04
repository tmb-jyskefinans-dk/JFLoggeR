// electron/db.ts
import { app } from 'electron';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { LowSync } from 'lowdb';
import { JSONFileSync } from 'lowdb/node';

export type Entry = {
  id?: number;          // not used but kept for compatibility with older code
  day: string;          // 'YYYY-MM-DD'
  start: string;        // 'HH:MM'
  end: string;          // 'HH:MM'
  description: string;
  category: string;
  created_at?: string;  // ISO time
};

export type Settings = {
  work_start: string;    // "08:00"
  work_end: string;      // "16:00"
  slot_minutes: number;  // 15
  weekdays_mask: number; // bitmask Sun..Sat (Sun=1<<0)
  auto_focus_on_slot?: boolean; // bring app to front & open dialog on new slot
  notification_silent?: boolean; // notifications play no sound when true
  stale_threshold_minutes?: number; // minutes beyond slot length before stale prompt
  auto_start_on_login?: boolean; // launch app on OS login
  group_notifications?: boolean; // consolidate missed notifications when away
};

type Data = {
  entries: Entry[];
  settings: Settings;
  _seq: number;         // simple incremental id if you ever want it
};

const DEFAULT_SETTINGS: Settings = {
  work_start: '08:00',
  work_end: '16:00',
  slot_minutes: 15,
  weekdays_mask: 0b0111110, // Mon–Fri
  auto_focus_on_slot: false,
  notification_silent: true,
  stale_threshold_minutes: 45,
  auto_start_on_login: false,
  group_notifications: true
};

let db: LowSync<Data>;

function ensureDb() {
  // Lazy init safeguard in case callers access before main.ts calls initDb()
  if (!db) {
    initDb();
  }
}

export function initDb() {
  const dir = app.getPath('userData');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const file = path.join(dir, '/worklogger.json');
  console.log("DB file path:", file);

  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({}));

  const seed: Data = { entries: [], settings: DEFAULT_SETTINGS, _seq: 1 };
  // We let the first write via lowdb create the file if missing.
  db = new LowSync<Data>(new JSONFileSync<Data>(file), seed);
  db.read();

  // Ensure shape (and create file on first write if it was missing)
  let changed = false;
  if (!db.data) {
    db.data = seed;
    changed = true;
  }
  if (!db.data.settings) { db.data.settings = { ...DEFAULT_SETTINGS }; changed = true; }
  else {
    // ensure new fields
    if (typeof db.data.settings.auto_focus_on_slot !== 'boolean') {
      db.data.settings.auto_focus_on_slot = DEFAULT_SETTINGS.auto_focus_on_slot!;
      changed = true;
    }
    if (typeof db.data.settings.notification_silent !== 'boolean') { db.data.settings.notification_silent = DEFAULT_SETTINGS.notification_silent!; changed = true; }
    if (typeof db.data.settings.stale_threshold_minutes !== 'number') { db.data.settings.stale_threshold_minutes = DEFAULT_SETTINGS.stale_threshold_minutes!; changed = true; }
    if (typeof db.data.settings.auto_start_on_login !== 'boolean') { db.data.settings.auto_start_on_login = DEFAULT_SETTINGS.auto_start_on_login!; changed = true; }
    if (typeof db.data.settings.group_notifications !== 'boolean') { db.data.settings.group_notifications = DEFAULT_SETTINGS.group_notifications!; changed = true; }
  }
  if (typeof db.data._seq !== 'number') { db.data._seq = 1; changed = true; }
  if (!Array.isArray(db.data.entries)) { db.data.entries = []; changed = true; }
  if (changed) db.write();
}

/** SETTINGS */
export function getSettings(): Settings {
  ensureDb();
  db.read();
  return db.data!.settings;
}
export function saveSettings(s: Settings) {
  ensureDb();
  db.read();
  db.data!.settings = {
    work_start: s.work_start,
    work_end: s.work_end,
    slot_minutes: Number(s.slot_minutes) || 15,
    weekdays_mask: Number(s.weekdays_mask) >>> 0,
    auto_focus_on_slot: !!s.auto_focus_on_slot,
    notification_silent: !!s.notification_silent,
    stale_threshold_minutes: Number(s.stale_threshold_minutes) || DEFAULT_SETTINGS.stale_threshold_minutes!,
    auto_start_on_login: !!s.auto_start_on_login,
    group_notifications: !!s.group_notifications
  };
  db.write();
}

/** ENTRIES - core helpers */
function entryKey(e: Pick<Entry, 'day'|'start'>) {
  return `${e.day}T${e.start}`;
}

export function saveEntries(entries: Entry[]) {
  ensureDb();
  db.read();
  const nowISO = new Date().toISOString();

  // Build a map of existing entries by (day,start)
  const existing = new Map<string, Entry>();
  for (const e of db.data!.entries) {
    existing.set(entryKey(e), e);
  }

  for (const raw of entries) {
    const e: Entry = {
      ...raw,
      created_at: raw.created_at ?? nowISO
    };
    existing.set(entryKey(e), e);
  }

  db.data!.entries = Array.from(existing.values())
    .sort((a, b) => (a.day === b.day ? a.start.localeCompare(b.start) : a.day.localeCompare(b.day)));

  db.write();
}

export function getDayEntries(day: string) {
  ensureDb();
  db.read();
  return db.data!.entries
    .filter(e => e.day === day)
    .sort((a,b)=> a.start.localeCompare(b.start));
}

export function getDays() {
  ensureDb();
  db.read();
  const counts = new Map<string, number>();
  for (const e of db.data!.entries) {
    counts.set(e.day, (counts.get(e.day) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([day, slots]) => ({ day, slots }))
    .sort((a,b)=> b.day.localeCompare(a.day));
}

export function getSummary(day: string) {
  ensureDb();
  db.read();
  const s = getSettings();
  const entries = db.data!.entries.filter(e => e.day === day);
  const grouped = new Map<string, { description: string; category: string; slots: number }>();

  for (const e of entries) {
    const key = `${e.description}||${e.category}`;
    if (!grouped.has(key)) grouped.set(key, { description: e.description, category: e.category, slots: 0 });
    grouped.get(key)!.slots++;
  }

  return Array.from(grouped.values())
    .map(g => ({ ...g, minutes: g.slots * s.slot_minutes }))
    .sort((a,b)=> b.minutes - a.minutes || a.description.localeCompare(b.description));
}

// Suggest a category for a given description based on historical usage excluding 'Andet'
// Category suggestion feature removed.

export function getDistinctRecent(limit = 20) {
  ensureDb();
  db.read();
  const grouped = new Map<string, { description: string; category: string; uses: number; last_used: string }>();
  for (const e of db.data!.entries) {
    const key = `${e.description}||${e.category}`;
    if (!grouped.has(key)) {
      grouped.set(key, { description: e.description, category: e.category, uses: 0, last_used: e.created_at ?? '' });
    }
    const g = grouped.get(key)!;
    g.uses++;
    if (e.created_at && (!g.last_used || e.created_at > g.last_used)) g.last_used = e.created_at;
  }
  return Array.from(grouped.values())
    .sort((a,b)=> b.last_used.localeCompare(a.last_used))
    .slice(0, limit);
}

// Variant that also reports how many times an item was used today (local date)
export function getDistinctRecentToday(limit = 20) {
  ensureDb();
  db.read();
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth()+1).padStart(2,'0');
  const d = String(today.getDate()).padStart(2,'0');
  const todayKey = `${y}-${m}-${d}`;
  type Row = { description: string; category: string; uses: number; uses_today: number; last_used: string };
  const grouped = new Map<string, Row>();
  for (const e of db.data!.entries) {
    const key = `${e.description}||${e.category}`;
    if (!grouped.has(key)) {
      grouped.set(key, { description: e.description, category: e.category, uses: 0, uses_today: 0, last_used: e.created_at ?? '' });
    }
    const g = grouped.get(key)!;
    g.uses++;
    if (e.day === todayKey) g.uses_today++;
    if (e.created_at && (!g.last_used || e.created_at > g.last_used)) g.last_used = e.created_at;
  }
  return Array.from(grouped.values())
    .sort((a,b)=> b.last_used.localeCompare(a.last_used))
    .slice(0, limit);
}

/** Delete a single entry by (day,start). Returns number of removed entries. */
export function deleteEntry(day: string, start: string) {
  ensureDb();
  db.read();
  const before = db.data!.entries.length;
  db.data!.entries = db.data!.entries.filter(e => !(e.day === day && e.start === start));
  if (db.data!.entries.length !== before) {
    db.write();
    return 1;
  }
  return 0;
}

/** Convenience (kept for API parity) */
export function ensureDayCreated(day?: string) { return day; }
export function lastNEntries(n = 8) {
  ensureDb();
  db.read();
  return [...db.data!.entries]
    .sort((a,b)=> (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, n);
}
