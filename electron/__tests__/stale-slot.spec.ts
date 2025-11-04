import { computeStaleSlot } from '../stale';
import { getSettings, saveSettings, initDb } from '../db';

/**
 * Tests for computeStaleSlot helper (pure function).
 */

describe('computeStaleSlot', () => {
  beforeAll(() => { initDb(); });

  test('returns null when no pending keys', () => {
    const s = getSettings();
    const result = computeStaleSlot([], new Date(), s, s.slot_minutes);
    expect(result).toBeNull();
  });

  test('returns null when age below threshold', () => {
    const s = getSettings();
    saveSettings({ ...s, stale_threshold_minutes: 60 });
    const now = new Date('2025-11-04T10:00:00');
    const pending = ['2025-11-04T09:30']; // age 30m
    const result = computeStaleSlot(pending, now, getSettings(), getSettings().slot_minutes);
    expect(result).toBeNull();
  });

  test('detects stale slot over threshold', () => {
    const s = getSettings();
    saveSettings({ ...s, stale_threshold_minutes: 20 });
    const now = new Date('2025-11-04T10:00:00');
    const pending = ['2025-11-04T09:30']; // age 30m
    const result = computeStaleSlot(pending, now, getSettings(), getSettings().slot_minutes);
    expect(result).not.toBeNull();
    expect(result!.key).toBe('2025-11-04T09:30');
    expect(Math.round(result!.ageMinutes)).toBe(30);
  });

  test('ignores pending slots from previous day', () => {
    const s = getSettings();
    const now = new Date('2025-11-05T09:00:00');
    const pending = ['2025-11-04T15:00'];
    const result = computeStaleSlot(pending, now, s, s.slot_minutes);
    expect(result).toBeNull();
  });
});
