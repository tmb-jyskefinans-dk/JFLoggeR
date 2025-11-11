import { importExternalLines, initDb, getSettings } from '../db';

// Basic Jest tests for import expansion logic.

describe('importExternalLines', () => {
  beforeAll(() => {
    try { initDb(); } catch { /* ignore */ }
  });

  it('expands aligned 30-minute interval into two slot-sized entries', () => {
    const gran = getSettings().slot_minutes;
    expect(gran).toBeGreaterThan(0);
    const start = new Date(); start.setHours(8,0,0,0);
    const end = new Date(start.getTime() + gran*2*60000);
    const line = JSON.stringify({ entry_id: 'x', task: 'Test', segment_start: start.toISOString(), segment_end: end.toISOString(), minutes: gran*2 });
    const res = importExternalLines(line);
    expect(res.imported).toBe(2);
    expect(res.skipped).toBe(0);
  });

  it('skips too short interval shorter than slot size', () => {
    const gran = getSettings().slot_minutes;
    const start = new Date(); start.setHours(9,0,0,0);
    const end = new Date(start.getTime() + (gran/3)*60000); // shorter than one slot
    const line = JSON.stringify({ entry_id: 'y', task: 'Short', segment_start: start.toISOString(), segment_end: end.toISOString(), minutes: (gran/3) });
    const res = importExternalLines(line);
    expect(res.imported).toBe(0);
    expect(res.skipped).toBeGreaterThan(0);
  });
});
