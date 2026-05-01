import { findAdjacentPreviousEntry, getPreviousSlotKey } from '../../src/app/components/log-dialog/log-dialog-prefill.util';

describe('log dialog previous-slot prefill', () => {
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