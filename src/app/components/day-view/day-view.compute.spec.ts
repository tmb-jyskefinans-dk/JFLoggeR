import { computeMissingRows } from './day-view.component';

describe('computeMissingRows', () => {
  const settings = { work_start: '08:00', work_end: '09:00', slot_minutes: 15 };
  const day = '2025-11-11';
  test('generates placeholders for uncovered slots', () => {
    const entries = [
      { start: '08:15', end: '08:30', description: 'Task', category: 'Work' }
    ];
    // Use time after work_end (10:00 = 600 minutes since midnight) so all potential slots considered past
    const nowMinutes = 10 * 60; // 10:00
    const rows = computeMissingRows(entries, settings, day, nowMinutes);
    const missing = rows.filter(r => r.missing).map(r => r.start);
    // Expected slots: 08:00, 08:30, 08:45 (since work window 08:00-09:00)
    expect(missing).toEqual(['08:00','08:30','08:45']);
  });
  test('excludes future slots when day is today', () => {
    const entries: any[] = []; // none logged
    // now at 08:32 so slots started before 08:32 are candidates: 08:00,08:15, 08:30
    const nowMinutes = 8 * 60 + 32; // 08:32 = 512 minutes since midnight
    const rows = computeMissingRows(entries, settings, day, nowMinutes);
    const missing = rows.filter(r => r.missing).map(r => r.start);
    expect(missing).toEqual(['08:00','08:15','08:30']);
  });
});
