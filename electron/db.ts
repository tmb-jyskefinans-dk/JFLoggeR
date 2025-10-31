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
  weekdays_mask: 0b0111110 // Mon–Fri
};

let db: LowSync<Data>;

function ensureDb() {
  // Lazy init safeguard in case callers access before main.ts calls initDb()
  if (!db) {
    initDb();
  }
}

export function initDb() {
  const dir = app.getPath('userData')+ "/worklogger";
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
    weekdays_mask: Number(s.weekdays_mask) >>> 0
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

/** Convenience (kept for API parity) */
export function ensureDayCreated(day?: string) { return day; }
export function lastNEntries(n = 8) {
  ensureDb();
  db.read();
  return [...db.data!.entries]
    .sort((a,b)=> (b.created_at ?? '').localeCompare(a.created_at ?? ''))
    .slice(0, n);
}
