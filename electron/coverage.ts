export type MinuteRange = [number, number];

export function hmToMinute(hm: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm ?? '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
}

export function minuteToHm(total: number): string {
  const wrapped = ((Math.floor(total) % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, '0')}:${String(wrapped % 60).padStart(2, '0')}`;
}

/** Parts of [from, to) not covered by any entry; entries may be of any length or alignment. */
export function uncoveredRanges(from: number, to: number, entries: ReadonlyArray<{ start: string; end: string }>): MinuteRange[] {
  const intervals = entries
    .map(e => [hmToMinute(e.start), hmToMinute(e.end)] as MinuteRange)
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s && e > from && s < to)
    .sort((a, b) => a[0] - b[0]);
  const gaps: MinuteRange[] = [];
  let cursor = from;
  for (const [s, e] of intervals) {
    if (s > cursor) gaps.push([cursor, Math.min(s, to)]);
    cursor = Math.max(cursor, e);
    if (cursor >= to) break;
  }
  if (cursor < to) gaps.push([cursor, to]);
  return gaps;
}
