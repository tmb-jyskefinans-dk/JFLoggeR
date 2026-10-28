export interface IslandEntryLike {
  start: string;
  end: string;
  description: string;
  category: string;
  created_at?: string;
}

export interface SlotRange {
  start: string;
  end: string;
  minutesLeft: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

export function hmToMinutes(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? '').trim());
  if (!m) return NaN;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToHm(total: number): string {
  const wrapped = ((Math.floor(total) % 1440) + 1440) % 1440;
  return `${pad2(Math.floor(wrapped / 60))}:${pad2(wrapped % 60)}`;
}

/** Mirrors electron/time.ts currentSlotStart: slots snap within the hour by slot length. */
export function currentSlotRange(now: Date, slotMinutes: number): SlotRange {
  const gran = Number.isFinite(slotMinutes) && slotMinutes > 0 ? Math.trunc(slotMinutes) : 15;
  const startMin = now.getHours() * 60 + Math.floor(now.getMinutes() / gran) * gran;
  const endMin = startMin + gran;
  const nowExact = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  return {
    start: minutesToHm(startMin),
    end: minutesToHm(endMin),
    minutesLeft: Math.max(0, Math.ceil(endMin - nowExact))
  };
}

export function isWithinWorkHours(now: Date, workStart: string, workEnd: string): boolean {
  const start = hmToMinutes(workStart);
  const end = hmToMinutes(workEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return false;
  const mins = now.getHours() * 60 + now.getMinutes();
  return mins >= start && mins < end;
}

export function workdayMinutes(workStart: string, workEnd: string): number {
  const start = hmToMinutes(workStart);
  const end = hmToMinutes(workEnd);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? end - start : 0;
}

export function loggedMinutes(entries: readonly IslandEntryLike[]): number {
  return entries.reduce((sum, e) => {
    const s = hmToMinutes(e.start);
    const t = hmToMinutes(e.end);
    return Number.isFinite(s) && Number.isFinite(t) && t > s ? sum + (t - s) : sum;
  }, 0);
}

export function progressRatio(logged: number, total: number): number {
  if (!(total > 0)) return 0;
  return Math.min(1, Math.max(0, logged / total));
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rest = m % 60;
  if (!h) return `${rest}m`;
  return rest ? `${h}t ${rest}m` : `${h}t`;
}

/** Most recently created entry, falling back to the latest start time. */
export function lastLoggedEntry<T extends IslandEntryLike>(entries: readonly T[]): T | null {
  let best: T | null = null;
  for (const e of entries) {
    if (!e?.description || !e?.category) continue;
    if (!best) { best = e; continue; }
    const a = e.created_at ?? '';
    const b = best.created_at ?? '';
    if (a > b || (a === b && e.start > best.start)) best = e;
  }
  return best;
}

export function newestPendingSlot(slots: readonly string[]): string | null {
  return slots.length ? [...slots].sort()[slots.length - 1] : null;
}

export interface NextLogSlot {
  time: string;
  minutesUntil: number;
}

/** Next moment a slot ends and is queued for logging today, or null when the workday is over/disabled. */
export function nextLogSlot(
  now: Date,
  settings: { slot_minutes?: number; work_start?: string; work_end?: string; weekdays_mask?: number }
): NextLogSlot | null {
  const mask = Number(settings.weekdays_mask);
  if (Number.isFinite(mask) && (mask & (1 << now.getDay())) === 0) return null;
  const start = hmToMinutes(settings.work_start ?? '08:00');
  const end = hmToMinutes(settings.work_end ?? '16:00');
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const gran = Number(settings.slot_minutes) > 0 ? Math.trunc(Number(settings.slot_minutes)) : 15;
  const nowExact = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const target = nowExact < start
    ? Math.min(start + gran, end)
    : Math.min(hmToMinutes(currentSlotRange(now, gran).end), end);
  if (nowExact >= end || target <= nowExact) return null;
  return { time: minutesToHm(target), minutesUntil: Math.max(1, Math.ceil(target - nowExact)) };
}
