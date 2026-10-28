import { findAdjacentPreviousEntry, findPrefillEntry, getPreviousSlotKey } from '../../src/app/components/log-dialog/log-dialog-prefill.util';

describe('log dialog previous-slot prefill', () => {
  test('prefill falls back to the latest earlier entry the same day', () => {
    const entries = [
      { day: '2026-04-22', start: '09:00', description: 'Old', category: 'Admin' },
      { day: '2026-04-22', start: '10:00', description: 'Budget review', category: 'Møder' },
      { day: '2026-04-22', start: '11:00', description: 'Later', category: 'Admin' },
      { day: '2026-04-21', start: '10:15', description: 'Yesterday', category: 'Admin' }
    ];
    expect(findPrefillEntry('2026-04-22T10:30', entries, 15)?.description).toBe('Budget review');
    expect(findPrefillEntry('2026-04-22T09:15', entries, 15)?.description).toBe('Old');
    expect(findPrefillEntry('2026-04-22T08:00', entries, 15)).toBeNull();
  });

  test('prefill prefers the adjacent previous slot', () => {
    const entries = [
      { day: '2026-04-22', start: '10:15', description: 'Adjacent', category: 'Møder' },
      { day: '2026-04-22', start: '10:00', description: 'Earlier', category: 'Admin' }
    ];
    expect(findPrefillEntry('2026-04-22T10:30', entries, 15)?.description).toBe('Adjacent');
  });

  test('returns the immediately previous slot key for a prompted slot', () => {
    expect(getPreviousSlotKey('2026-04-22T10:30', 15)).toBe('2026-04-22T10:15');
  });

  test('does not cross before midnight for previous-slot reuse', () => {
    expect(getPreviousSlotKey('2026-04-22T00:10', 15)).toBeNull();
  });

  test('finds the adjacent previous logged entry when it touches the prompted slot', () => {
    const entry = findAdjacentPreviousEntry(
      '2026-04-22T10:30',
      [
        { day: '2026-04-22', start: '10:15', description: 'Budget review', category: 'Møder' },
        { day: '2026-04-22', start: '09:45', description: 'Older task', category: 'Admin' }
      ],
      15
    );

    expect(entry).toEqual({
      day: '2026-04-22',
      start: '10:15',
      description: 'Budget review',
      category: 'Møder'
    });
  });

  test('ignores older entries when the adjacent slot is missing', () => {
    const entry = findAdjacentPreviousEntry(
      '2026-04-22T10:30',
      [
        { day: '2026-04-22', start: '10:00', description: 'Budget review', category: 'Møder' }
      ],
      15
    );

    expect(entry).toBeNull();
  });
});