import { uncoveredRanges, minuteToHm, hmToMinute, type MinuteRange } from './coverage';
import { normalizeWorkSchedule, usesWeeklySchedule, WORK_SLOT_MINUTES } from './work-schedule';

export const FLEX_CATEGORY = 'Andet';

export interface FlexSettingsLike {
  work_start?: string;
  work_end?: string;
  weekdays_mask?: number;
  work_schedule_mode?: unknown;
  work_schedule?: unknown;
}

export interface FlexEntryLike {
  day: string;
  start: string;
  end: string;
  category: string;
}

export interface FlexDay {
  plannedMinutes: number;
  workedMinutes: number;
  /** Logged work that falls outside the scheduled hours (overtime). */
  outsideScheduleMinutes: number;
  /** 'Andet' time when it is treated as flex (taken time off, not work). */
  flexMinutes: number;
  deltaMinutes: number;
}

export interface FlexBalance {
  balanceMinutes: number;
  fromDay: string;
  days: Record<string, FlexDay>;
}

function weekdayOf(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
}

/** Scheduled work ranges (minutes since midnight) for a weekday, merged where blocks touch. */
export function scheduledRanges(settings: FlexSettingsLike, weekday: number): MinuteRange[] {
  if (usesWeeklySchedule(settings)) {
    const ranges: MinuteRange[] = [];
    for (const slot of normalizeWorkSchedule(settings.work_schedule)[weekday] ?? []) {
      const start = hmToMinute(slot);
      const last = ranges[ranges.length - 1];
      if (last && last[1] === start) last[1] = start + WORK_SLOT_MINUTES;
      else ranges.push([start, start + WORK_SLOT_MINUTES]);
    }
    return ranges;
  }
  const mask = Number(settings.weekdays_mask);
  if (Number.isFinite(mask) && (mask & (1 << weekday)) === 0) return [];
  const start = hmToMinute(settings.work_start ?? '08:00');
  const end = hmToMinute(settings.work_end ?? '16:00');
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? [[start, end]] : [];
}

const span = (ranges: MinuteRange[]) => ranges.reduce((sum, [s, e]) => sum + Math.max(0, e - s), 0);

/**
 * Flex balance over every day that has entries, from `fromDay` up to `today`.
 * Today only counts the part of the schedule that has already passed (`nowMinutes`).
 * Days without any entries are skipped so days the app was not used do not count as minus.
 */
export function computeFlexBalance(
  entries: readonly FlexEntryLike[],
  settings: FlexSettingsLike,
  opts: { today: string; nowMinutes: number; fromDay?: string; excludeFlexCategory?: boolean }
): FlexBalance {
  const byDay = new Map<string, FlexEntryLike[]>();
  for (const e of entries) {
    if (!e?.day || e.day > opts.today || (opts.fromDay && e.day < opts.fromDay)) continue;
    if (!byDay.has(e.day)) byDay.set(e.day, []);
    byDay.get(e.day)!.push(e);
  }

  const days: Record<string, FlexDay> = {};
  let balanceMinutes = 0;
  for (const [day, dayEntries] of byDay) {
    const weekday = weekdayOf(day);
    if (weekday === null) continue;
    let schedule = scheduledRanges(settings, weekday);
    if (day === opts.today) {
      schedule = schedule
        .map(([s, e]) => [s, Math.min(e, opts.nowMinutes)] as MinuteRange)
        .filter(([s, e]) => e > s);
    }
    const scheduleAsEntries = schedule.map(([s, e]) => ({ start: minuteToHm(s), end: minuteToHm(e) }));

    let workedMinutes = 0;
    let flexMinutes = 0;
    let outsideScheduleMinutes = 0;
    for (const e of dayEntries) {
      const minutes = Math.max(0, hmToMinute(e.end) - hmToMinute(e.start));
      if (!Number.isFinite(minutes) || !minutes) continue;
      if (opts.excludeFlexCategory && e.category === FLEX_CATEGORY) {
        flexMinutes += minutes;
        continue;
      }
      workedMinutes += minutes;
      outsideScheduleMinutes += span(uncoveredRanges(hmToMinute(e.start), hmToMinute(e.end), scheduleAsEntries));
    }

    const plannedMinutes = span(schedule);
    const deltaMinutes = workedMinutes - plannedMinutes;
    days[day] = { plannedMinutes, workedMinutes, outsideScheduleMinutes, flexMinutes, deltaMinutes };
    balanceMinutes += deltaMinutes;
  }

  const sortedDays = Object.keys(days).sort();
  return { balanceMinutes, fromDay: opts.fromDay || sortedDays[0] || opts.today, days };
}
