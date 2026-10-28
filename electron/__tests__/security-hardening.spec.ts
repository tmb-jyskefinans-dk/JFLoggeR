import { escapeJqlString, normalizeJiraConnection } from '../jira-client';
import { getDayEntries, importExternalLines, initDb, saveEntries } from '../db';

describe('security hardening', () => {
  beforeAll(() => {
    try { initDb(); } catch { /* ignore */ }
  });

  test('JQL strings cannot break out of their quotes', () => {
    expect(escapeJqlString('a"b')).toBe('a\\"b');
    // A trailing backslash must not escape the closing quote.
    expect(escapeJqlString('x\\" OR project = SECRET')).toBe('x\\\\\\" OR project = SECRET');
    expect(escapeJqlString('line\nbreak')).toBe('line break');
  });

  test('project keys are restricted to the Jira key alphabet', () => {
    const c = normalizeJiraConnection({ id: 'x', project_key: 'abc" OR 1=1' });
    expect(c?.project_key).toBe('ABCOR11');
  });

  test('malformed entries from the renderer are not persisted', () => {
    const day = '2001-02-03';
    saveEntries([
      { day, start: '08:00', end: '08:15', description: 'ok', category: 'c' },
      { day, start: '25:00', end: '26:00', description: 'bad time', category: 'c' },
      { day: '../../etc', start: '09:00', end: '09:15', description: 'bad day', category: 'c' },
      { day, start: '10:00', end: '09:00', description: 'end before start', category: 'c' },
      { day, start: '11:00', end: '11:15', description: 'x'.repeat(5000), category: 'c', ...({ extra: 'dropped' } as object) }
    ] as never);
    const rows = getDayEntries(day);
    expect(rows.map(r => r.start)).toEqual(['08:00', '11:00']);
    expect(rows[1].description.length).toBe(500);
    expect((rows[1] as unknown as Record<string, unknown>)['extra']).toBeUndefined();
  });

  test('import rejects segments longer than a day', () => {
    const line = JSON.stringify({ task: 'Huge', segment_start: '1970-01-01T00:00:00', segment_end: '2100-01-01T00:00:00' });
    const res = importExternalLines(line);
    expect(res.imported).toBe(0);
    expect(res.skipped).toBe(1);
  });
});
