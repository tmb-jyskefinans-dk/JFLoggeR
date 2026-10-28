import { getJiraAfstemRows, isJiraAfstemRow, shouldJiraAutoLogOnAfstem } from './jira-afstem.util';

describe('jira-afstem.util', () => {
  test('enables Jira auto-log only when setting is on and the active connection is usable', () => {
    const onprem = { id: 'a', type: 'server', base_url: 'https://jira.local/jira', token: 'abc' };
    const cloud = { id: 'b', type: 'cloud', base_url: 'https://x.atlassian.net', token: 'abc', email: '' };
    const settings = (active: string, on = true) => ({ jira_log_on_afstem: on, jira_connections: [onprem, cloud], jira_active_connection_id: active });
    expect(shouldJiraAutoLogOnAfstem(settings('a'))).toBe(true);
    expect(shouldJiraAutoLogOnAfstem(settings('a', false))).toBe(false);
    expect(shouldJiraAutoLogOnAfstem(settings('b'))).toBe(false);
    expect(shouldJiraAutoLogOnAfstem(settings('missing'))).toBe(false);
  });

  test('matches only Jira-key rows in allowed categories', () => {
    expect(isJiraAfstemRow({ category: 'Udvikling (prioriterede jf. projektoversigten)', description: 'ABC-123 - Fix bug' })).toBe(true);
    expect(isJiraAfstemRow({ category: 'Udvikling (prioriterede jf. projektoversigten)', description: 'No jira key' })).toBe(false);
    expect(isJiraAfstemRow({ category: 'Møde', description: 'ABC-123 - Fix bug' })).toBe(false);
  });

  test('filters rows consistently for shared afstem behavior', () => {
    const rows = [
      { category: 'Udvikling (prioriterede jf. projektoversigten)', description: 'ABC-123 - A', minutes: 30 },
      { category: 'Estimering', description: 'DEF-42 - B', minutes: 15 },
      { category: 'Estimering', description: 'No key here', minutes: 10 },
      { category: 'Møde', description: 'XYZ-1 - C', minutes: 20 }
    ];
    const eligible = getJiraAfstemRows(rows);
    expect(eligible.length).toBe(2);
    expect(eligible.map(r => r.description)).toEqual(['ABC-123 - A', 'DEF-42 - B']);
  });
});
