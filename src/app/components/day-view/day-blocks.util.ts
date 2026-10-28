import { formatDuration, hmToMinutes, minutesToHm, workdayMinutes } from '../island/island-status.util';
import {
  effectiveSlotMinutes,
  scheduledMinutesForWeekday,
  slotStartMinutesForWeekday,
  usesWeeklySchedule,
  weekdayFromYmd,
  type WorkScheduleSettingsLike
} from '../../models/work-schedule';

export interface DayRowLike {
  start: string;
  end: string;
  description?: string;
  category?: string;
  missing?: boolean;
  /** Grid slot a missing range belongs to; used as the pending/log key. */
  slotStart?: string;
}

export interface MissingRow extends DayRowLike {
  description: '';
  category: '';
  missing: true;
  slotStart: string;
}

/** Mirrors electron/coverage.ts: parts of [from, to) not covered by any entry, whatever its length/alignment. */
export function uncoveredRanges(from: number, to: number, entries: readonly DayRowLike[]): Array<[number, number]> {
  const intervals = entries
    .map(e => [hmToMinutes(e.start), hmToMinutes(e.end)] as [number, number])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s && e > from && s < to)
    .sort((a, b) => a[0] - b[0]);
  const gaps: Array<[number, number]> = [];
  let cursor = from;
  for (const [s, e] of intervals) {
    if (s > cursor) gaps.push([cursor, Math.min(s, to)]);
    cursor = Math.max(cursor, e);
    if (cursor >= to) break;
  }
  if (cursor < to) gaps.push([cursor, to]);
  return gaps;
}

/**
 * Unlogged parts of the day's scheduled slots that have started before `nowMinutes`
 * (or are already pending). Leftovers from an older slot length only leave the real remainder missing.
 */
export function missingRowsForDay(
  entries: readonly DayRowLike[],
  settings: WorkScheduleSettingsLike,
  day: string,
  nowMinutes: number,
  pendingStarts: ReadonlySet<string> = new Set()
): MissingRow[] {
  const weekday = weekdayFromYmd(day);
  if (weekday === null) return [];
  const slotStarts = slotStartMinutesForWeekday(settings, weekday);
  if (!slotStarts) return [];
  const gran = effectiveSlotMinutes(settings);
  const logged = entries.filter(e => !e.missing);
  const rows: MissingRow[] = [];
  for (const m of slotStarts) {
    const slotStart = minutesToHm(m);
    if (m >= nowMinutes && !pendingStarts.has(slotStart)) continue;
    for (const [from, to] of uncoveredRanges(m, m + gran, logged)) {
      rows.push({ start: minutesToHm(from), end: minutesToHm(to), description: '', category: '', missing: true, slotStart });
    }
  }
  return rows;
}

export interface DayBlock<T extends DayRowLike> {
  kind: 'entry' | 'missing';
  start: string;
  end: string;
  minutes: number;
  description: string;
  category: string;
  rows: T[];
}

function rowMinutes(row: DayRowLike): number {
  const diff = hmToMinutes(row.end) - hmToMinutes(row.start);
  return Number.isFinite(diff) && diff > 0 ? diff : 0;
}

/** Merges back-to-back slots with the same description/category (or consecutive gaps) into one block. */
export function groupDayBlocks<T extends DayRowLike>(rows: readonly T[]): DayBlock<T>[] {
  const blocks: DayBlock<T>[] = [];
  for (const row of rows) {
    const kind = row.missing ? 'missing' : 'entry';
    const description = row.description ?? '';
    const category = row.category ?? '';
    const last = blocks[blocks.length - 1];
    const sameContent = kind === 'missing' || (last?.description === description && last?.category === category);
    if (last && last.kind === kind && last.end === row.start && sameContent) {
      last.end = row.end;
      last.minutes += rowMinutes(row);
      last.rows.push(row);
      continue;
    }
    blocks.push({ kind, start: row.start, end: row.end, minutes: rowMinutes(row), description, category, rows: [row] });
  }
  return blocks;
}

export interface CategoryTotal {
  category: string;
  minutes: number;
}

export function categoryTotals(rows: readonly DayRowLike[]): CategoryTotal[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.missing || !row.category) continue;
    const minutes = rowMinutes(row);
    if (minutes) totals.set(row.category, (totals.get(row.category) ?? 0) + minutes);
  }
  return [...totals].map(([category, minutes]) => ({ category, minutes })).sort((a, b) => b.minutes - a.minutes);
}

/** Splits a leading Jira key ("ABC-123 - Summary") off a description. */
export function splitJiraKey(description: string): { key: string; text: string } {
  const match = /^([A-Z][A-Z0-9_]*-\d+)\s*-\s*(.*)$/.exec(String(description ?? '').trim());
  return match ? { key: match[1], text: match[2] } : { key: '', text: String(description ?? '') };
}

/** ISO-8601 week (Monday start, week 1 contains the year's first Thursday) as used on Danish calendars. */
export function isoWeek(ymd: string): { year: number; week: number } {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return { year: date.getUTCFullYear(), week: Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7) };
}

export function shiftYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, (d || 1) + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function plannedMinutesForDay(settings: WorkScheduleSettingsLike | null | undefined, ymd: string): number {
  const weekday = weekdayFromYmd(ymd);
  if (!settings || weekday === null) return 0;
  if (usesWeeklySchedule(settings)) return scheduledMinutesForWeekday(settings, weekday);
  const mask = Number(settings.weekdays_mask);
  if (Number.isFinite(mask) && (mask & (1 << weekday)) === 0) return 0;
  return workdayMinutes(settings.work_start ?? '08:00', settings.work_end ?? '16:00');
}

export { formatDuration };
