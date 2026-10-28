import { uncoveredRanges } from '../coverage';
import { missingRowsForDay, groupDayBlocks } from '../../src/app/components/day-view/day-blocks.util';

const e = (start: string, end: string) => ({ start, end, description: 'x', category: 'y' });

describe('slot coverage with leftovers from another slot length', () => {
  test('uncoveredRanges returns only the unlogged minutes', () => {
    expect(uncoveredRanges(765, 780, [e('12:45', '12:49')])).toEqual([[769, 780]]);
    expect(uncoveredRanges(660, 675, [e('11:05', '11:06'), e('11:10', '11:11')])).toEqual([[660, 665], [666, 670], [671, 675]]);
    expect(uncoveredRanges(600, 615, [e('09:50', '10:20')])).toEqual([]);
    expect(uncoveredRanges(600, 615, [])).toEqual([[600, 615]]);
  });

  test('missing rows stay on the current grid and never overlap leftovers', () => {
    const settings = { work_start: '11:00', work_end: '13:00', slot_minutes: 15, weekdays_mask: 0b1111111 };
    const entries = [e('11:05', '11:06'), e('12:15', '12:45'), e('12:45', '12:49')];
    const rows = missingRowsForDay(entries, settings, '2026-10-28', 13 * 60);

    const blocks = groupDayBlocks([...entries, ...rows].sort((a, b) => a.start.localeCompare(b.start)))
      .filter(b => b.kind === 'missing')
      .map(b => `${b.start}-${b.end}`);
    expect(blocks).toEqual(['11:00-11:05', '11:06-12:15', '12:49-13:00']);

    // Gaps keep their grid slot as the log key, so logging uses normal pending slots.
    expect(rows.find(r => r.start === '12:49')?.slotStart).toBe('12:45');
    expect(rows.find(r => r.start === '11:06')?.slotStart).toBe('11:00');
  });

  test('only slots started before now are shown unless already pending', () => {
    const settings = { work_start: '08:00', work_end: '09:00', slot_minutes: 15, weekdays_mask: 0b1111111 };
    expect(missingRowsForDay([], settings, '2026-10-28', 8 * 60 + 20).map(r => r.start)).toEqual(['08:00', '08:15']);
    expect(missingRowsForDay([], settings, '2026-10-28', 8 * 60 + 20, new Set(['08:30'])).map(r => r.start)).toEqual(['08:00', '08:15', '08:30']);
  });
});
