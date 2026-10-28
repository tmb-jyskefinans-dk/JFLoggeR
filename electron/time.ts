// electron/time.ts
import { getSettings } from './db';
import {
  isScheduledSlot,
  normalizeWorkSchedule,
  usesWeeklySchedule
} from './work-schedule';

export function toLocalDateYMD(d = new Date()) {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, '0');
  const dd = `${d.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export function parseHM(hm: string) {
  const [h, m] = hm.split(':').map(Number);
  return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}

/** Slot length accessors */
export function getSlotMinutes() {
  // Always read dynamically so changes to settings apply immediately.
  const parsed = Math.trunc(Number(getSettings().slot_minutes));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15;
}

/** Workday helpers */
export function isWorkdayEnabled(d = new Date()) {
  const s = getSettings();
  if (usesWeeklySchedule(s)) return (normalizeWorkSchedule(s.work_schedule)[d.getDay()]?.length ?? 0) > 0;
  const bit = 1 << d.getDay(); // Sun=0..Sat=6
  return (s.weekdays_mask & bit) !== 0;
}

export function isWorkTime(now = new Date()) {
  const s = getSettings();
  if (usesWeeklySchedule(s)) return isScheduledSlot(normalizeWorkSchedule(s.work_schedule), now);
  const { h: sh, m: sm } = parseHM(s.work_start);
  const { h: eh, m: em } = parseHM(s.work_end);
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return isWorkdayEnabled(now) && mins >= start && mins < end;
}

/** Whether the slot that just finished (prevStart) at the given boundary should be queued and notified. */
export function shouldPromptForFinishedSlot(boundary: Date, prevStart: Date) {
  const s = getSettings();
  if (usesWeeklySchedule(s)) return isScheduledSlot(normalizeWorkSchedule(s.work_schedule), prevStart);
  if (!isWorkTime(boundary)) return false;
  const { h: dsh, m: dsm } = parseHM(s.work_start);
  const { h: deh, m: dem } = parseHM(s.work_end);
  const dayStart = new Date(boundary); dayStart.setHours(dsh, dsm, 0, 0);
  const dayEnd = new Date(boundary); dayEnd.setHours(deh, dem, 0, 0);
  return prevStart >= dayStart && prevStart < dayEnd;
}

/** Slot math */
export function currentSlotStart(now = new Date()) {
  const gran = getSlotMinutes();
  const d = new Date(now);
  const minutes = Math.floor(d.getMinutes() / gran) * gran;
  d.setMinutes(minutes, 0, 0);
  return d;
}

export function nextQuarter(now = new Date()) {
  const gran = getSlotMinutes();
  const d = new Date(now);
  const minutes = Math.floor(d.getMinutes() / gran) * gran + gran;
  d.setMinutes(minutes, 0, 0);
  return d;
}

/** Start time of the previous slot (the slot that just finished at the current boundary). */
export function previousSlotStart(now = new Date()) {
  const gran = getSlotMinutes();
  // Subtract gran minutes then snap to slot boundary using currentSlotStart logic.
  const prior = new Date(now.getTime() - gran * 60000);
  return currentSlotStart(prior);
}

export function daySlots(date = new Date()) {
  const s = getSettings();
  const gran = getSlotMinutes();
  if (usesWeeklySchedule(s)) {
    // Slots of the configured length whose start falls inside a selected schedule block.
    const schedule = normalizeWorkSchedule(s.work_schedule);
    const slots: Date[] = [];
    for (let m = 0; m < 24 * 60; m += gran) {
      const slot = new Date(date);
      slot.setHours(Math.floor(m / 60), m % 60, 0, 0);
      if (isScheduledSlot(schedule, slot)) slots.push(slot);
    }
    return slots;
  }
  if (gran <= 0) return [];
  // Respect configured working days; return empty when disabled for this date.
  if (!isWorkdayEnabled(date)) return [];
  const { h: sh, m: sm } = parseHM(s.work_start);
  const { h: eh, m: em } = parseHM(s.work_end);

  const start = new Date(date); start.setHours(sh, sm, 0, 0);
  const end   = new Date(date); end.setHours(eh, em, 0, 0);

  const slots: Date[] = [];
  for (let t = start; t < end; t = new Date(t.getTime() + gran * 60000)) {
    slots.push(new Date(t));
  }
  return slots;
}

export function slotKey(d: Date) {
  const ymd = toLocalDateYMD(d);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${ymd}T${hh}:${mm}`;
}
