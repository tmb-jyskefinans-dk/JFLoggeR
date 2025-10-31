import { getSlotMinutes } from '../time';
import { saveSettings, getSettings } from '../db';

// Helper to modify settings
function updateSlotMinutes(value: number) {
  const current = getSettings();
  saveSettings({ ...current, slot_minutes: value });
}

describe('getSlotMinutes', () => {
  test('returns default slot length (15)', () => {
    expect(getSlotMinutes()).toBe(15);
  });

  test('reflects updated settings after saveSettings()', () => {
    updateSlotMinutes(30);
    expect(getSlotMinutes()).toBe(30);
  });

  test('falls back to 15 when invalid slot_minutes provided', () => {
    // Force an invalid value (NaN) through casting
    const current = getSettings();
    // Intentionally pass NaN via Number('foo')
    saveSettings({ ...current, slot_minutes: Number('foo') });
    expect(getSlotMinutes()).toBe(15);
  });
});
