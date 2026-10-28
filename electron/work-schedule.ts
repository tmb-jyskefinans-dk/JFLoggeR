export const WORK_SLOT_MINUTES = 15;
export const WEEKDAY_COUNT = 7;

export type WorkSchedule = string[][];
// 'interval' = legacy work_start/work_end/slot_minutes/weekdays_mask; 'weekly' = per-day 15-minute timetable.
export type WorkScheduleMode = 'interval' | 'weekly';

export function minuteToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

export function timeToMinute(value: string): number | null {
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function emptyWorkSchedule(): WorkSchedule {
  return Array.from({ length: WEEKDAY_COUNT }, () => []);
}

export function normalizeWorkSchedule(value: unknown): WorkSchedule {
  if (!Array.isArray(value)) return emptyWorkSchedule();

  return Array.from({ length: WEEKDAY_COUNT }, (_, weekday) => {
    const day = value[weekday];
    if (!Array.isArray(day)) return [];

    return Array.from(new Set(
      day
        .filter((slot): slot is string => typeof slot === 'string')
        .filter(slot => {
          const minute = timeToMinute(slot);
          return minute !== null && minute % WORK_SLOT_MINUTES === 0;
        })
    )).sort();
  });
}

export function normalizeWorkScheduleMode(value: unknown): WorkScheduleMode {
  return value === 'weekly' ? 'weekly' : 'interval';
}

export function usesWeeklySchedule(settings: { work_schedule_mode?: unknown }): boolean {
  return normalizeWorkScheduleMode(settings?.work_schedule_mode) === 'weekly';
}

export function isScheduledSlot(schedule: WorkSchedule, date: Date): boolean {
  const minute = date.getHours() * 60 + date.getMinutes();
  const slot = minuteToTime(Math.floor(minute / WORK_SLOT_MINUTES) * WORK_SLOT_MINUTES);
  return schedule[date.getDay()]?.includes(slot) ?? false;
}
