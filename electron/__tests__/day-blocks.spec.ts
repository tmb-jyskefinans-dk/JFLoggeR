import {
  categoryTotals,
  groupDayBlocks,
  isoWeek,
  plannedMinutesForDay,
  shiftYmd,
  splitJiraKey
} from '../../src/app/components/day-view/day-blocks.util';

describe('day blocks util', () => {
  test('merges back-to-back slots with identical content and consecutive gaps', () => {
    const rows = [
      { start: '08:00', end: '08:15', description: 'ABC-1 - Fix', category: 'Dev' },
      { start: '08:15', end: '08:30', description: 'ABC-1 - Fix', category: 'Dev' },
      { start: '08:30', end: '08:45', description: 'ABC-1 - Fix', category: 'Møde' },
      { start: '08:45', end: '09:00', missing: true },
      { start: '09:00', end: '09:15', missing: true },
      { start: '09:30', end: '09:45', description: 'ABC-1 - Fix', category: 'Møde' }
    ];
    const blocks = groupDayBlocks(rows);
    expect(blocks.map(b => `${b.kind}:${b.start}-${b.end}:${b.minutes}`)).toEqual([
      'entry:08:00-08:30:30',
      'entry:08:30-08:45:15',
      'missing:08:45-09:15:30',
      'entry:09:30-09:45:15'
    ]);
    expect(blocks[0].rows.length).toBe(2);
  });

  test('category totals skip gaps and sort by time spent', () => {
    const totals = categoryTotals([
      { start: '08:00', end: '08:15', category: 'A' },
      { start: '08:15', end: '09:00', category: 'B' },
      { start: '09:00', end: '09:15', missing: true },
      { start: '09:15', end: '09:30', category: 'A' }
    ]);
    expect(totals).toEqual([{ category: 'B', minutes: 45 }, { category: 'A', minutes: 30 }]);
  });

  test('splits leading Jira keys', () => {
    expect(splitJiraKey('TEAMJYFWEB-42 - Ny forside')).toEqual({ key: 'TEAMJYFWEB-42', text: 'Ny forside' });
    expect(splitJiraKey('Frokost')).toEqual({ key: '', text: 'Frokost' });
  });

  test('ISO week numbers follow the Danish calendar', () => {
    expect(isoWeek('2026-10-28')).toEqual({ year: 2026, week: 44 });
    expect(isoWeek('2026-11-01')).toEqual({ year: 2026, week: 44 }); // Sunday belongs to the Monday-started week
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 });
  });

  test('shifts dates across month boundaries', () => {
    expect(shiftYmd('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftYmd('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('planned minutes respect the weekday mask and weekly schedule', () => {
    const interval = { work_start: '08:00', work_end: '16:00', weekdays_mask: 0b0111110 };
    expect(plannedMinutesForDay(interval, '2026-10-28')).toBe(480);
    expect(plannedMinutesForDay(interval, '2026-11-01')).toBe(0);
    const schedule = Array.from({ length: 7 }, () => [] as string[]);
    schedule[3] = ['08:00', '08:15', '08:30'];
    expect(plannedMinutesForDay({ work_schedule_mode: 'weekly', work_schedule: schedule }, '2026-10-28')).toBe(45);
  });
});
