"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toLocalDateYMD = toLocalDateYMD;
exports.parseHM = parseHM;
exports.getSlotMinutes = getSlotMinutes;
exports.isWorkdayEnabled = isWorkdayEnabled;
exports.isWorkTime = isWorkTime;
exports.currentSlotStart = currentSlotStart;
exports.nextQuarter = nextQuarter;
exports.previousSlotStart = previousSlotStart;
exports.daySlots = daySlots;
exports.slotKey = slotKey;
// electron/time.ts
const db_1 = require("./db");
function toLocalDateYMD(d = new Date()) {
    const y = d.getFullYear();
    const m = `${d.getMonth() + 1}`.padStart(2, '0');
    const dd = `${d.getDate()}`.padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
function parseHM(hm) {
    const [h, m] = hm.split(':').map(Number);
    return { h: Number.isFinite(h) ? h : 0, m: Number.isFinite(m) ? m : 0 };
}
/** Slot length accessors */
function getSlotMinutes() {
    // Always read dynamically so changes to settings apply immediately.
    return (0, db_1.getSettings)().slot_minutes;
}
/** Workday helpers */
function isWorkdayEnabled(d = new Date()) {
    const { weekdays_mask } = (0, db_1.getSettings)();
    const bit = 1 << d.getDay(); // Sun=0..Sat=6
    return (weekdays_mask & bit) !== 0;
}
function isWorkTime(now = new Date()) {
    const s = (0, db_1.getSettings)();
    const { h: sh, m: sm } = parseHM(s.work_start);
    const { h: eh, m: em } = parseHM(s.work_end);
    const mins = now.getHours() * 60 + now.getMinutes();
    const start = sh * 60 + sm;
    const end = eh * 60 + em;
    return isWorkdayEnabled(now) && mins >= start && mins < end;
}
/** Slot math */
function currentSlotStart(now = new Date()) {
    const gran = getSlotMinutes();
    const d = new Date(now);
    const minutes = Math.floor(d.getMinutes() / gran) * gran;
    d.setMinutes(minutes, 0, 0);
    return d;
}
function nextQuarter(now = new Date()) {
    const gran = getSlotMinutes();
    const d = new Date(now);
    const minutes = Math.floor(d.getMinutes() / gran) * gran + gran;
    d.setMinutes(minutes, 0, 0);
    return d;
}
/** Start time of the previous slot (the slot that just finished at the current boundary). */
function previousSlotStart(now = new Date()) {
    const gran = getSlotMinutes();
    // Subtract gran minutes then snap to slot boundary using currentSlotStart logic.
    const prior = new Date(now.getTime() - gran * 60000);
    return currentSlotStart(prior);
}
function daySlots(date = new Date()) {
    const s = (0, db_1.getSettings)();
    const gran = getSlotMinutes();
    // Respect configured working days; return empty when disabled for this date.
    if (!isWorkdayEnabled(date))
        return [];
    const { h: sh, m: sm } = parseHM(s.work_start);
    const { h: eh, m: em } = parseHM(s.work_end);
    const start = new Date(date);
    start.setHours(sh, sm, 0, 0);
    const end = new Date(date);
    end.setHours(eh, em, 0, 0);
    const slots = [];
    for (let t = start; t < end; t = new Date(t.getTime() + gran * 60000)) {
        slots.push(new Date(t));
    }
    return slots;
}
function slotKey(d) {
    const ymd = toLocalDateYMD(d);
    const hh = `${d.getHours()}`.padStart(2, '0');
    const mm = `${d.getMinutes()}`.padStart(2, '0');
    return `${ymd}T${hh}:${mm}`;
}
//# sourceMappingURL=time.js.map