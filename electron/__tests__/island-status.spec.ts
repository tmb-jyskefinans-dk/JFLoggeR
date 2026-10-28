import {
  currentSlotRange,
  formatDuration,
  hmToMinutes,
  isWithinWorkHours,
  lastLoggedEntry,
  loggedMinutes,
  newestPendingSlot,
  nextLogSlot,
  progressRatio,
  workdayMinutes
} from '../../src/app/components/island/island-status.util';

describe('island status util', () => {
  test('current slot range and countdown', () => {
    const r = currentSlotRange(new Date(2026, 9, 28, 10, 7, 30), 15);
    expect(r.start).toBe('10:00');
    expect(r.end).toBe('10:15');
    expect(r.minutesLeft).toBe(8);
  });

  test('slot range crossing the hour', () => {
    const r = currentSlotRange(new Date(2026, 9, 28, 10, 50), 15);
    expect(r.start).toBe('10:45');
    expect(r.end).toBe('11:00');
  });

  test('work hours check', () => {
    expect(isWithinWorkHours(new Date(2026, 9, 28, 8, 0), '08:00', '16:00')).toBe(true);
    expect(isWithinWorkHours(new Date(2026, 9, 28, 16, 0), '08:00', '16:00')).toBe(false);
    expect(isWithinWorkHours(new Date(2026, 9, 28, 9, 0), 'bad', '16:00')).toBe(false);
  });

  test('logged minutes and progress', () => {
    const entries = [
      { start: '08:00', end: '08:15', description: 'a', category: 'x' },
      { start: '08:15', end: '09:00', description: 'b', category: 'x' },
      { start: '09:00', end: '08:00', description: 'bad', category: 'x' }
    ];
    expect(loggedMinutes(entries)).toBe(60);
    expect(workdayMinutes('08:00', '16:00')).toBe(480);
    expect(progressRatio(240, 480)).toBe(0.5);
    expect(progressRatio(600, 480)).toBe(1);
    expect(progressRatio(10, 0)).toBe(0);
  });

  test('duration formatting', () => {
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(120)).toBe('2t');
    expect(formatDuration(195)).toBe('3t 15m');
  });

  test('last logged entry prefers newest created_at', () => {
    const entries = [
      { start: '10:00', end: '10:15', description: 'late start', category: 'x', created_at: '2026-10-28T08:00:00Z' },
      { start: '08:00', end: '08:15', description: 'newest', category: 'y', created_at: '2026-10-28T09:00:00Z' }
    ];
    expect(lastLoggedEntry(entries)?.description).toBe('newest');
    expect(lastLoggedEntry([])).toBeNull();
  });

  test('next log slot during, before and after the workday', () => {
    const s = { slot_minutes: 15, work_start: '08:00', work_end: '16:00', weekdays_mask: 0b0111110 };
    expect(nextLogSlot(new Date(2026, 9, 28, 12, 42), s)).toEqual({ time: '12:45', minutesUntil: 3 });
    expect(nextLogSlot(new Date(2026, 9, 28, 7, 30), s)).toEqual({ time: '08:15', minutesUntil: 45 });
    expect(nextLogSlot(new Date(2026, 9, 28, 15, 50), s)).toEqual({ time: '16:00', minutesUntil: 10 });
    expect(nextLogSlot(new Date(2026, 9, 28, 16, 5), s)).toBeNull();
    expect(nextLogSlot(new Date(2026, 10, 1, 10, 0), s)).toBeNull();
  });

  test('newest pending slot and hm parsing', () => {
    expect(newestPendingSlot(['2026-10-28T09:15', '2026-10-28T10:00', '2026-10-28T09:45'])).toBe('2026-10-28T10:00');
    expect(newestPendingSlot([])).toBeNull();
    expect(hmToMinutes('07:30')).toBe(450);
    expect(Number.isNaN(hmToMinutes('x'))).toBe(true);
  });
});
