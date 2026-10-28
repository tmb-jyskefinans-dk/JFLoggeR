"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hmToMinute = hmToMinute;
exports.minuteToHm = minuteToHm;
exports.uncoveredRanges = uncoveredRanges;
function hmToMinute(hm) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? '').trim());
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}
function minuteToHm(total) {
    const wrapped = ((Math.floor(total) % 1440) + 1440) % 1440;
    return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}
/** Parts of [from, to) not covered by any entry; entries may be of any length or alignment. */
function uncoveredRanges(from, to, entries) {
    const intervals = entries
        .map(e => [hmToMinute(e.start), hmToMinute(e.end)])
        .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s && e > from && s < to)
        .sort((a, b) => a[0] - b[0]);
    const gaps = [];
    let cursor = from;
    for (const [s, e] of intervals) {
        if (s > cursor)
            gaps.push([cursor, Math.min(s, to)]);
        cursor = Math.max(cursor, e);
        if (cursor >= to)
            break;
    }
    if (cursor < to)
        gaps.push([cursor, to]);
    return gaps;
}
//# sourceMappingURL=coverage.js.map