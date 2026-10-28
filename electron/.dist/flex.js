"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FLEX_CATEGORY = void 0;
exports.scheduledRanges = scheduledRanges;
exports.computeFlexBalance = computeFlexBalance;
const coverage_1 = require("./coverage");
const work_schedule_1 = require("./work-schedule");
exports.FLEX_CATEGORY = 'Andet';
function weekdayOf(ymd) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
    if (!m)
        return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getDay();
}
/** Scheduled work ranges (minutes since midnight) for a weekday, merged where blocks touch. */
function scheduledRanges(settings, weekday) {
    if ((0, work_schedule_1.usesWeeklySchedule)(settings)) {
        const ranges = [];
        for (const slot of (0, work_schedule_1.normalizeWorkSchedule)(settings.work_schedule)[weekday] ?? []) {
            const start = (0, coverage_1.hmToMinute)(slot);
            const last = ranges[ranges.length - 1];
            if (last && last[1] === start)
                last[1] = start + work_schedule_1.WORK_SLOT_MINUTES;
            else
                ranges.push([start, start + work_schedule_1.WORK_SLOT_MINUTES]);
        }
        return ranges;
    }
    const mask = Number(settings.weekdays_mask);
    if (Number.isFinite(mask) && (mask & (1 << weekday)) === 0)
        return [];
    const start = (0, coverage_1.hmToMinute)(settings.work_start ?? '08:00');
    const end = (0, coverage_1.hmToMinute)(settings.work_end ?? '16:00');
    return Number.isFinite(start) && Number.isFinite(end) && end > start ? [[start, end]] : [];
}
const span = (ranges) => ranges.reduce((sum, [s, e]) => sum + Math.max(0, e - s), 0);
/**
 * Flex balance over every day that has entries, from `fromDay` up to `today`.
 * Today only counts the part of the schedule that has already passed (`nowMinutes`).
 * Days without any entries are skipped so days the app was not used do not count as minus.
 */
function computeFlexBalance(entries, settings, opts) {
    const byDay = new Map();
    for (const e of entries) {
        if (!e?.day || e.day > opts.today || (opts.fromDay && e.day < opts.fromDay))
            continue;
        if (!byDay.has(e.day))
            byDay.set(e.day, []);
        byDay.get(e.day).push(e);
    }
    const days = {};
    let balanceMinutes = 0;
    for (const [day, dayEntries] of byDay) {
        const weekday = weekdayOf(day);
        if (weekday === null)
            continue;
        let schedule = scheduledRanges(settings, weekday);
        if (day === opts.today) {
            schedule = schedule
                .map(([s, e]) => [s, Math.min(e, opts.nowMinutes)])
                .filter(([s, e]) => e > s);
        }
        const scheduleAsEntries = schedule.map(([s, e]) => ({ start: (0, coverage_1.minuteToHm)(s), end: (0, coverage_1.minuteToHm)(e) }));
        let workedMinutes = 0;
        let flexMinutes = 0;
        let outsideScheduleMinutes = 0;
        for (const e of dayEntries) {
            const minutes = Math.max(0, (0, coverage_1.hmToMinute)(e.end) - (0, coverage_1.hmToMinute)(e.start));
            if (!Number.isFinite(minutes) || !minutes)
                continue;
            if (opts.excludeFlexCategory && e.category === exports.FLEX_CATEGORY) {
                flexMinutes += minutes;
                continue;
            }
            workedMinutes += minutes;
            outsideScheduleMinutes += span((0, coverage_1.uncoveredRanges)((0, coverage_1.hmToMinute)(e.start), (0, coverage_1.hmToMinute)(e.end), scheduleAsEntries));
        }
        const plannedMinutes = span(schedule);
        const deltaMinutes = workedMinutes - plannedMinutes;
        days[day] = { plannedMinutes, workedMinutes, outsideScheduleMinutes, flexMinutes, deltaMinutes };
        balanceMinutes += deltaMinutes;
    }
    const sortedDays = Object.keys(days).sort();
    return { balanceMinutes, fromDay: opts.fromDay || sortedDays[0] || opts.today, days };
}
//# sourceMappingURL=flex.js.map