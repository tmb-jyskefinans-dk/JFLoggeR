export const WORK_SLOT_MINUTES = 15;
export const WEEKDAY_COUNT = 7;

export type WorkSchedule = string[][];
// 'interval' = legacy work_start/work_end/slot_minutes/weekdays_mask; 'weekly' = per-day 15-minute timetable.
export type WorkScheduleMode = 'interval' | 'weekly';

export interface WorkScheduleSettingsLike {
  work_start?: string;
  work_end?: string;
  slot_minutes?: number;
  weekdays_mask?: number;
  work_schedule_mode?: string;
  work_schedule?: unknown;
}

export function minuteToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

function hmToMinute(value: string | undefined): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export const ALL_WORK_SLOT_STARTS = Array.from(
  { length: (24 * 60) / WORK_SLOT_MINUTES },
  (_, index) => minuteToTime(index * WORK_SLOT_MINUTES)
);

export function emptyWorkSchedule(): WorkSchedule {
  return Array.from({ length: WEEKDAY_COUNT }, () => []);
}

export function normalizeWorkSchedule(value: unknown): WorkSchedule {
  if (!Array.isArray(value)) return emptyWorkSchedule();
  const validSlots = new Set(ALL_WORK_SLOT_STARTS);

  return Array.from({ length: WEEKDAY_COUNT }, (_, weekday) => {
    const day = value[weekday];
    if (!Array.isArray(day)) return [];
    return Array.from(new Set(
      day.filter((slot): slot is string => typeof slot === 'string' && validSlots.has(slot))
    )).sort();
  });
}

export function schedulesEqual(left: WorkSchedule, right: WorkSchedule): boolean {
  return left.every((slots, weekday) => {
    const other = right[weekday] ?? [];
    return slots.length === other.length && slots.every((slot, index) => slot === other[index]);
  });
}

/** Seeds a weekly timetable from the legacy interval settings (15-minute slots inside start..end on enabled weekdays). */
export function scheduleFromInterval(workStart: string, workEnd: string, weekdaysMask: number): WorkSchedule {
  const start = hmToMinute(workStart);
  const end = hmToMinute(workEnd);
  const schedule = emptyWorkSchedule();
  if (start === null || end === null || end <= start) return schedule;

  const firstSlot = Math.ceil(start / WORK_SLOT_MINUTES) * WORK_SLOT_MINUTES;
  for (let weekday = 0; weekday < WEEKDAY_COUNT; weekday++) {
    if ((weekdaysMask & (1 << weekday)) === 0) continue;
    for (let minute = firstSlot; minute < end; minute += WORK_SLOT_MINUTES) {
      schedule[weekday].push(minuteToTime(minute));
    }
  }
  return schedule;
}

export function usesWeeklySchedule(settings: WorkScheduleSettingsLike | null | undefined): boolean {
  return settings?.work_schedule_mode === 'weekly';
}

export function effectiveSlotMinutes(settings: WorkScheduleSettingsLike | null | undefined): number {
  const parsed = Math.trunc(Number(settings?.slot_minutes));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : WORK_SLOT_MINUTES;
}

export function weekdayFromYmd(day: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const date = Number(match[3]);
  const parsed = new Date(year, month - 1, date);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== date
  ) return null;
  return parsed.getDay();
}

/** Minutes of selected schedule blocks for a weekday (weekly mode only). */
export function scheduledMinutesForWeekday(settings: WorkScheduleSettingsLike, weekday: number): number {
  return (normalizeWorkSchedule(settings.work_schedule)[weekday]?.length ?? 0) * WORK_SLOT_MINUTES;
}

/**
 * Slot start minutes (since midnight) to be logged for a weekday, using the shared slot_minutes length.
 * Weekly mode: slots whose start falls inside a selected schedule block.
 * Interval mode keeps legacy behaviour (start..end, weekday mask not applied); null when not configured.
 */
export function slotStartMinutesForWeekday(settings: WorkScheduleSettingsLike, weekday: number): number[] | null {
  const gran = effectiveSlotMinutes(settings);
  if (usesWeeklySchedule(settings)) {
    const blocks = new Set(normalizeWorkSchedule(settings.work_schedule)[weekday] ?? []);
    const result: number[] = [];
    for (let m = 0; m < 24 * 60; m += gran) {
      if (blocks.has(minuteToTime(Math.floor(m / WORK_SLOT_MINUTES) * WORK_SLOT_MINUTES))) result.push(m);
    }
    return result;
  }
  const start = hmToMinute(settings.work_start);
  const end = hmToMinute(settings.work_end);
  if (start === null || end === null || end <= start) return null;
  const result: number[] = [];
  for (let m = start; m < end; m += gran) result.push(m);
  return result;
}
