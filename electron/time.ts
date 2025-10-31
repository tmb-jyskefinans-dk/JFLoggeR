// electron/time.ts
import { getSettings } from './db';

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
  return getSettings().slot_minutes;
}

/** Workday helpers */
export function isWorkdayEnabled(d = new Date()) {
  const { weekdays_mask } = getSettings();
  const bit = 1 << d.getDay(); // Sun=0..Sat=6
  return (weekdays_mask & bit) !== 0;
}

export function isWorkTime(now = new Date()) {
  const s = getSettings();
  const { h: sh, m: sm } = parseHM(s.work_start);
  const { h: eh, m: em } = parseHM(s.work_end);
  const mins = now.getHours() * 60 + now.getMinutes();
  const start = sh * 60 + sm;
  const end = eh * 60 + em;
  return isWorkdayEnabled(now) && mins >= start && mins < end;
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

export function daySlots(date = new Date()) {
  const s = getSettings();
  const gran = getSlotMinutes();
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
