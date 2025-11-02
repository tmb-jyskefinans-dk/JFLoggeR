import { getSettings, saveSettings } from '../db';
import { daySlots, toLocalDateYMD } from '../time';

// Test that non-workdays (e.g. Sunday with default Mon-Fri mask) produce zero slots

describe('daySlots respects weekdays_mask', () => {
  beforeAll(() => {
    // Ensure settings match default Mon-Fri mask (0b0111110)
    const s = getSettings();
    saveSettings({ ...s, weekdays_mask: 0b0111110 });
  });

  test('Sunday returns empty slot list', () => {
    // Find a known Sunday date
    const sunday = new Date('2025-01-05T12:00:00'); // 5 Jan 2025 is Sunday
    expect(sunday.getDay()).toBe(0);
    const slots = daySlots(sunday);
    expect(slots.length).toBe(0);
  });

  test('Monday returns slots', () => {
    const monday = new Date('2025-01-06T09:00:00'); // Monday
    expect(monday.getDay()).toBe(1);
    const slots = daySlots(monday);
    expect(slots.length).toBeGreaterThan(0);
    // All slots share the same ymd
    const ymd = toLocalDateYMD(monday);
    for (const s of slots) {
      expect(toLocalDateYMD(s)).toBe(ymd);
    }
  });
});
