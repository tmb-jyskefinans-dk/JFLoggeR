import { saveSettings, getSettings } from '../db';
import { previousSlotStart, currentSlotStart } from '../time';

// Test previousSlotStart returns the slot that just finished given a boundary time

describe('previousSlotStart', () => {
  beforeAll(() => {
    const s = getSettings();
    // Ensure slot granularity is 15 for predictable math
    saveSettings({ ...s, slot_minutes: 15 });
  });

  test('returns 15 minutes earlier slot boundary for a 15-min granularity (local time)', () => {
    const boundary = new Date('2025-11-03T10:30:00'); // start of slot 10:30 local
    const prev = previousSlotStart(boundary);
    const hh = String(prev.getHours()).padStart(2,'0');
    const mm = String(prev.getMinutes()).padStart(2,'0');
    expect(`${hh}:${mm}`).toBe('10:15');
  });

  test('aligns to snapped boundary even if boundary has seconds', () => {
    const boundary = new Date('2025-11-03T10:30:13');
    const prev = previousSlotStart(boundary);
    expect(prev.getMinutes()).toBe(15);
    expect(prev.getSeconds()).toBe(0);
  });

  test('works with modified granularity (30)', () => {
    const original = getSettings();
    saveSettings({ ...original, slot_minutes: 30 });
    const boundary = new Date('2025-11-03T11:30:00'); // start of new slot
    const prev = previousSlotStart(boundary);
    const hh = String(prev.getHours()).padStart(2,'0');
    const mm = String(prev.getMinutes()).padStart(2,'0');
    expect(`${hh}:${mm}`).toBe('11:00');
    // restore 15
    saveSettings({ ...original, slot_minutes: 15 });
  });

  test('currentSlotStart(boundary - gran) matches previousSlotStart(boundary)', () => {
    const boundary = new Date('2025-11-03T12:45:00');
    const prev = previousSlotStart(boundary);
    const gran = getSettings().slot_minutes;
    const adjusted = new Date(boundary.getTime() - gran * 60000);
    expect(currentSlotStart(adjusted).getTime()).toBe(prev.getTime());
  });
});
