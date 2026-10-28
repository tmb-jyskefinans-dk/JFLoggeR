"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WEEKDAY_COUNT = exports.WORK_SLOT_MINUTES = void 0;
exports.minuteToTime = minuteToTime;
exports.timeToMinute = timeToMinute;
exports.emptyWorkSchedule = emptyWorkSchedule;
exports.normalizeWorkSchedule = normalizeWorkSchedule;
exports.normalizeWorkScheduleMode = normalizeWorkScheduleMode;
exports.usesWeeklySchedule = usesWeeklySchedule;
exports.isScheduledSlot = isScheduledSlot;
exports.WORK_SLOT_MINUTES = 15;
exports.WEEKDAY_COUNT = 7;
function minuteToTime(minutes) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}
function timeToMinute(value) {
    if (!/^\d{2}:\d{2}$/.test(value))
        return null;
    const [hours, minutes] = value.split(':').map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes))
        return null;
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59)
        return null;
    return hours * 60 + minutes;
}
function emptyWorkSchedule() {
    return Array.from({ length: exports.WEEKDAY_COUNT }, () => []);
}
function normalizeWorkSchedule(value) {
    if (!Array.isArray(value))
        return emptyWorkSchedule();
    return Array.from({ length: exports.WEEKDAY_COUNT }, (_, weekday) => {
        const day = value[weekday];
        if (!Array.isArray(day))
            return [];
        return Array.from(new Set(day
            .filter((slot) => typeof slot === 'string')
            .filter(slot => {
            const minute = timeToMinute(slot);
            return minute !== null && minute % exports.WORK_SLOT_MINUTES === 0;
        }))).sort();
    });
}
function normalizeWorkScheduleMode(value) {
    return value === 'weekly' ? 'weekly' : 'interval';
}
function usesWeeklySchedule(settings) {
    return normalizeWorkScheduleMode(settings?.work_schedule_mode) === 'weekly';
}
function isScheduledSlot(schedule, date) {
    const minute = date.getHours() * 60 + date.getMinutes();
    const slot = minuteToTime(Math.floor(minute / exports.WORK_SLOT_MINUTES) * exports.WORK_SLOT_MINUTES);
    return schedule[date.getDay()]?.includes(slot) ?? false;
}
//# sourceMappingURL=work-schedule.js.map