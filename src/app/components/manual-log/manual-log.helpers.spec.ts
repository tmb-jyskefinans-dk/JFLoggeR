import { buildSlotKeys, filterNovelSlots, prefillDate, shouldEmitClosed } from './manual-log.component';

describe('ManualLogComponent helpers', () => {
  test('buildSlotKeys aligns to slot length and excludes end boundary', () => {
    const keys = buildSlotKeys('2025-11-11', '08:05', '08:40', 15);
    expect(keys).toEqual([
      '2025-11-11T08:00',
      '2025-11-11T08:15',
      '2025-11-11T08:30'
    ]);
  });
  test('filterNovelSlots removes existing keys', () => {
    const all = ['dT08:00','dT08:15','dT08:30'];
    const novel = filterNovelSlots(all, ['dT08:15']);
    expect(novel).toEqual(['dT08:00','dT08:30']);
  });
  test('prefillDate validates format', () => {
    expect(prefillDate('2025-11-11', '2025-01-01')).toBe('2025-11-11');
    expect(prefillDate('invalid', '2025-01-01')).toBe('2025-01-01');
  });
  test('shouldEmitClosed true only in dialog mode', () => {
    expect(shouldEmitClosed(true)).toBe(true);
    expect(shouldEmitClosed(false)).toBe(false);
  });
});
