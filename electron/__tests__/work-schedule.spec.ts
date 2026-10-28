import { daySlots, getSlotMinutes, isWorkdayEnabled, isWorkTime, shouldPromptForFinishedSlot } from '../time';
import { getSettings, saveSettings } from '../db';
import { isInWorkTime, nextLogSlot, plannedWorkMinutes } from '../../src/app/components/island/island-status.util';
import { scheduleFromInterval, slotStartMinutesForWeekday } from '../../src/app/models/work-schedule';

const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

function emptySchedule(): string[][] {
  return Array.from({ length: 7 }, () => [] as string[]);
}

describe('work schedule modes', () => {
  const legacy = { work_start: '08:00', work_end: '16:00', slot_minutes: 30, weekdays_mask: 0b0111110 };

  beforeEach(() => {
    saveSettings({ ...getSettings(), ...legacy, work_schedule_mode: 'interval', work_schedule: emptySchedule() });
  });

  afterAll(() => {
    saveSettings({ ...getSettings(), work_start: '08:00', work_end: '16:00', slot_minutes: 15, work_schedule_mode: 'interval' });
  });

  test('interval mode keeps legacy behaviour even when a weekly schedule is stored', () => {
    const schedule = emptySchedule();
    schedule[1] = ['10:00'];
    saveSettings({ ...getSettings(), work_schedule: schedule });
    const monday = new Date(2025, 0, 6, 12, 0);

    expect(getSlotMinutes()).toBe(30);
    expect(daySlots(monday).length).toBe(16);
    expect(isWorkTime(new Date(2025, 0, 6, 12, 0))).toBe(true);
    expect(isWorkdayEnabled(new Date(2025, 0, 5))).toBe(false);
  });

  test('interval mode prompts for finished slots inside the work window', () => {
    expect(shouldPromptForFinishedSlot(new Date(2025, 0, 6, 9, 0), new Date(2025, 0, 6, 8, 30))).toBe(true);
    expect(shouldPromptForFinishedSlot(new Date(2025, 0, 6, 7, 30), new Date(2025, 0, 6, 7, 0))).toBe(false);
  });

  test('weekly mode uses only selected blocks, including a lunch gap', () => {
    const schedule = emptySchedule();
    schedule[1] = ['08:00', '08:15', '13:00'];
    saveSettings({ ...getSettings(), slot_minutes: 15, work_schedule_mode: 'weekly', work_schedule: schedule });
    const monday = new Date(2025, 0, 6, 12, 0);

    expect(getSlotMinutes()).toBe(15);
    expect(daySlots(monday).map(hm)).toEqual(['08:00', '08:15', '13:00']);
    expect(isWorkTime(new Date(2025, 0, 6, 8, 5))).toBe(true);
    expect(isWorkTime(new Date(2025, 0, 6, 12, 0))).toBe(false);
    expect(isWorkdayEnabled(new Date(2025, 0, 7))).toBe(false);
    expect(shouldPromptForFinishedSlot(new Date(2025, 0, 6, 13, 15), new Date(2025, 0, 6, 13, 0))).toBe(true);
    expect(shouldPromptForFinishedSlot(new Date(2025, 0, 6, 12, 15), new Date(2025, 0, 6, 12, 0))).toBe(false);
  });

  test('weekly mode shares the configured interval length', () => {
    const schedule = emptySchedule();
    schedule[1] = ['08:00', '08:15', '08:30', '08:45', '13:00'];
    saveSettings({ ...getSettings(), slot_minutes: 30, work_schedule_mode: 'weekly', work_schedule: schedule });

    expect(getSlotMinutes()).toBe(30);
    expect(daySlots(new Date(2025, 0, 6, 12, 0)).map(hm)).toEqual(['08:00', '08:30', '13:00']);
  });

  test('weekly mode preserves the legacy interval fields', () => {
    saveSettings({ ...getSettings(), work_schedule_mode: 'weekly' });
    const s = getSettings();
    expect(s.work_start).toBe('08:00');
    expect(s.work_end).toBe('16:00');
    expect(s.slot_minutes).toBe(30);
    expect(s.weekdays_mask).toBe(0b0111110);
  });

  test('saving without mode or schedule keeps the stored values', () => {
    const schedule = emptySchedule();
    schedule[5] = ['08:00'];
    saveSettings({ ...getSettings(), work_schedule_mode: 'weekly', work_schedule: schedule });
    const rest = { ...getSettings() };
    delete rest.work_schedule_mode;
    delete rest.work_schedule;
    saveSettings(rest);
    expect(getSettings().work_schedule_mode).toBe('weekly');
    expect(getSettings().work_schedule?.[5]).toEqual(['08:00']);
  });
});

describe('renderer work schedule helpers', () => {
  test('scheduleFromInterval seeds 15-minute slots on enabled weekdays', () => {
    const schedule = scheduleFromInterval('08:00', '09:00', 0b0000010);
    expect(schedule[1]).toEqual(['08:00', '08:15', '08:30', '08:45']);
    expect(schedule[2]).toEqual([]);
  });

  test('slotStartMinutesForWeekday keeps legacy interval range', () => {
    const settings = { work_start: '08:00', work_end: '09:00', slot_minutes: 30 };
    expect(slotStartMinutesForWeekday(settings, 0)).toEqual([480, 510]);
    expect(slotStartMinutesForWeekday({ ...settings, work_end: '07:00' }, 1)).toBeNull();
  });

  test('island helpers follow the weekly schedule', () => {
    const schedule = emptySchedule();
    schedule[1] = ['08:00', '13:00'];
    const settings = { work_schedule_mode: 'weekly', work_schedule: schedule };

    expect(isInWorkTime(new Date(2025, 0, 6, 8, 10), settings)).toBe(true);
    expect(isInWorkTime(new Date(2025, 0, 6, 12, 0), settings)).toBe(false);
    expect(plannedWorkMinutes(new Date(2025, 0, 6, 12, 0), settings)).toBe(30);
    expect(nextLogSlot(new Date(2025, 0, 6, 9, 0), settings)).toEqual({ time: '13:15', minutesUntil: 255 });
    expect(nextLogSlot(new Date(2025, 0, 6, 14, 0), settings)).toBeNull();
  });
});
