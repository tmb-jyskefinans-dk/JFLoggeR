import { computeFlexBalance, scheduledRanges } from '../flex';

const interval = { work_start: '08:00', work_end: '16:00', weekdays_mask: 0b0111110 };
const e = (day: string, start: string, end: string, category = 'Udvikling') => ({ day, start, end, category });

describe('flex balance', () => {
  test('full workday plus overtime outside the schedule gives a plus', () => {
    // 2026-10-27 is a Tuesday: 8h planned, logged 08:00-17:00.
    const res = computeFlexBalance([e('2026-10-27', '08:00', '17:00')], interval, { today: '2026-10-28', nowMinutes: 600 });
    expect(res.days['2026-10-27']).toEqual({ plannedMinutes: 480, workedMinutes: 540, outsideScheduleMinutes: 60, flexMinutes: 0, deltaMinutes: 60 });
    expect(res.balanceMinutes).toBe(60);
  });

  test("'Andet' counts as flex time off when excluded", () => {
    const entries = [e('2026-10-27', '08:00', '12:00'), e('2026-10-27', '12:00', '16:00', 'Andet')];
    const excluded = computeFlexBalance(entries, interval, { today: '2026-10-28', nowMinutes: 600, excludeFlexCategory: true });
    expect(excluded.days['2026-10-27'].deltaMinutes).toBe(-240);
    expect(excluded.days['2026-10-27'].flexMinutes).toBe(240);

    const included = computeFlexBalance(entries, interval, { today: '2026-10-28', nowMinutes: 600, excludeFlexCategory: false });
    expect(included.days['2026-10-27'].deltaMinutes).toBe(0);
  });

  test('today only plans the part of the schedule that has passed', () => {
    // 10:00 now -> 2h planned so far, 1h30 logged.
    const res = computeFlexBalance([e('2026-10-28', '08:00', '09:30')], interval, { today: '2026-10-28', nowMinutes: 600 });
    expect(res.days['2026-10-28'].plannedMinutes).toBe(120);
    expect(res.days['2026-10-28'].deltaMinutes).toBe(-30);
  });

  test('weekend work is all plus; days without entries and before the start date are ignored', () => {
    const entries = [e('2026-10-25', '10:00', '11:00'), e('2026-10-20', '08:00', '09:00')];
    const res = computeFlexBalance(entries, interval, { today: '2026-10-28', nowMinutes: 600, fromDay: '2026-10-21' });
    expect(Object.keys(res.days)).toEqual(['2026-10-25']);
    expect(res.days['2026-10-25']).toMatchObject({ plannedMinutes: 0, outsideScheduleMinutes: 60, deltaMinutes: 60 });
    expect(res.fromDay).toBe('2026-10-21');
  });

  test('weekly schedule blocks are merged into ranges', () => {
    const schedule = Array.from({ length: 7 }, () => [] as string[]);
    schedule[3] = ['08:00', '08:15', '09:00'];
    expect(scheduledRanges({ work_schedule_mode: 'weekly', work_schedule: schedule }, 3)).toEqual([[480, 510], [540, 555]]);
  });
});
