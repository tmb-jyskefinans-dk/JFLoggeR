import { initDb, saveEntries, getDayEntries, deleteEntry } from '../db';

// Basic integration test for deleteEntry

describe('deleteEntry', () => {
  const day = '2025-11-02';

  beforeAll(() => {
    initDb();
  });

  test('removes a previously saved entry', () => {
    // Save one entry
    saveEntries([{
      day,
      start: '08:00',
      end: '08:15',
      description: 'Test work',
      category: 'Dev'
    }]);
    expect(getDayEntries(day).length).toBeGreaterThanOrEqual(1);

    const removed = deleteEntry(day, '08:00');
    expect(removed).toBe(1);
    expect(getDayEntries(day).find(e => e.start === '08:00')).toBeUndefined();
  });

  test('no-op when entry does not exist', () => {
    const before = getDayEntries(day).length;
    const removed = deleteEntry(day, '09:00');
    expect(removed).toBe(0);
    expect(getDayEntries(day).length).toBe(before);
  });
});
