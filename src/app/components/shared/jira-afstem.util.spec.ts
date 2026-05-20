import { getJiraAfstemRows, isJiraAfstemRow, shouldJiraAutoLogOnAfstem } from './jira-afstem.util';

describe('jira-afstem.util', () => {
  test('enables Jira auto-log only when both setting and psa key are present', () => {
    expect(shouldJiraAutoLogOnAfstem({ jira_log_on_afstem: true, jira_psa_key: 'abc' })).toBe(true);
    expect(shouldJiraAutoLogOnAfstem({ jira_log_on_afstem: true, jira_psa_key: '' })).toBe(false);
    expect(shouldJiraAutoLogOnAfstem({ jira_log_on_afstem: false, jira_psa_key: 'abc' })).toBe(false);
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
