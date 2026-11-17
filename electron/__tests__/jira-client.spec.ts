import {
  buildJiraSearchUrl,
  buildJiraWorklogBody,
  buildJiraWorklogUrl,
  DEFAULT_JIRA_BASE_URL,
  describeJiraHttpError,
  jiraAuthHeaders,
  jiraBrowserLoginOrigin,
  jiraConnectionMissingConfig,
  jiraUserIdFromMyself,
  migrateStoredJiraConnections,
  normalizeActiveJiraConnectionId,
  normalizeJiraConnection,
  normalizeJiraConnections,
  type JiraConnection
} from '../jira-client';

const site: JiraConnection = {
  id: 'cloud',
  name: 'Cloud',
  base_url: 'https://firma.atlassian.net',
  project_key: 'ABC',
  token: 'session-cookie'
};

describe('jira-client', () => {
  test('normalizes connections and rejects non-https urls', () => {
    const c = normalizeJiraConnection({ id: 'x', base_url: 'https://firma.atlassian.net/', project_key: 'abc', email: 'a@b.dk' });
    expect(c).toEqual({ id: 'x', name: 'Jira Cloud', base_url: 'https://firma.atlassian.net', project_key: 'ABC', token: '' });
    expect(normalizeJiraConnection({ id: 'y', base_url: 'http://insecure' })?.base_url).toBe('');
    expect(normalizeJiraConnection({ id: 'z', base_url: '  ' })?.base_url).toBe(DEFAULT_JIRA_BASE_URL);
    expect(normalizeJiraConnection({ id: 'w' })?.base_url).toBe(DEFAULT_JIRA_BASE_URL);
    expect(normalizeJiraConnection({ name: 'no id' })).toBeNull();
    expect(normalizeJiraConnections([{ id: 'a' }, { id: 'a' }, null]).length).toBe(1);
  });

  test('migrates stored connections to browser-login only', () => {
    const migrated = migrateStoredJiraConnections([
      { id: 'onprem', type: 'server', auth: 'token', base_url: 'https://jira.corp.local/jira', token: 'psa' },
      { id: 'api', type: 'cloud', auth: 'token', base_url: 'https://firma.atlassian.net', token: 'api-token', email: 'me@firma.dk' },
      { id: 'sso', type: 'cloud', auth: 'browser', base_url: 'https://firma.atlassian.net', token: 'cookie' },
      { id: 'new', name: 'Ny', base_url: 'https://firma.atlassian.net', project_key: 'ABC', token: 'cookie2' }
    ]);
    expect(migrated.map((c) => [c.id, c.token])).toEqual([['api', ''], ['sso', 'cookie'], ['new', 'cookie2']]);
    expect(migrated.every((c) => !('type' in c) && !('auth' in c) && !('email' in c))).toBe(true);
    expect(migrateStoredJiraConnections(undefined)).toEqual([]);
  });

  test('falls back to first connection when active id is unknown', () => {
    const other = { ...site, id: 'other' };
    expect(normalizeActiveJiraConnectionId([site, other], 'other')).toBe('other');
    expect(normalizeActiveJiraConnectionId([site, other], 'gone')).toBe('cloud');
    expect(normalizeActiveJiraConnectionId([], 'gone')).toBe('');
  });

  test('reports missing url or browser login', () => {
    expect(jiraConnectionMissingConfig(undefined)).toBeTruthy();
    expect(jiraConnectionMissingConfig(site)).toBeNull();
    expect(jiraConnectionMissingConfig({ ...site, token: '' })).toContain('browser');
    expect(jiraConnectionMissingConfig({ ...site, base_url: 'https://api.atlassian.com/ex/jira/abc' })).toContain('URL');
  });

  test('builds API v3 search/jql and worklog urls', () => {
    expect(buildJiraSearchUrl(site, 'project = ABC', ['key'], 5))
      .toBe('https://firma.atlassian.net/rest/api/3/search/jql?jql=project%20%3D%20ABC&fields=key&maxResults=5');
    expect(buildJiraWorklogUrl(site, 'ABC-1')).toBe('https://firma.atlassian.net/rest/api/3/issue/ABC-1/worklog');
    expect(buildJiraWorklogUrl(site, 'ABC-1', '42')).toBe('https://firma.atlassian.net/rest/api/3/issue/ABC-1/worklog/42?adjustEstimate=leave');
  });

  test('builds worklog bodies with ADF comments', () => {
    const body = buildJiraWorklogBody(900, '2026-01-01T08:00:00.000+0100', 'hi');
    expect(body.timeSpentSeconds).toBe(900);
    expect(body.comment.type).toBe('doc');
    expect(body.comment.content[0].content[0].text).toBe('hi');
  });

  test('describes Jira HTTP errors with body details', () => {
    expect(describeJiraHttpError(400, { errors: { timeSpent: 'Invalid' } })).toBe('HTTP 400 - Invalid.');
    expect(describeJiraHttpError(500, undefined)).toBe('HTTP 500.');
    expect(describeJiraHttpError(401, {})).toContain('Log ind igen');
    expect(describeJiraHttpError(403, {})).toContain('Work on issues');
    const xsrf = describeJiraHttpError(403, 'XSRF check failed');
    expect(xsrf).toContain('XSRF check failed');
    expect(xsrf).not.toContain('Work on issues');
  });

  test('resolves user id from /myself accountId', () => {
    expect(jiraUserIdFromMyself({ accountId: '5b10a' })).toBe('5b10a');
    expect(jiraUserIdFromMyself({})).toBeUndefined();
  });

  test('sends no Authorization header and passes Jira XSRF checks', () => {
    const headers = jiraAuthHeaders(site);
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['X-Atlassian-Token']).toBe('no-check');
    expect(headers['Origin']).toBe('https://firma.atlassian.net');
    expect(headers['User-Agent']).not.toMatch(/Mozilla/);
  });

  test('browser login only targets https Jira sites, not the scoped API gateway', () => {
    expect(jiraBrowserLoginOrigin('https://firma.atlassian.net/')).toBe('https://firma.atlassian.net');
    expect(jiraBrowserLoginOrigin('https://api.atlassian.com/ex/jira/abc')).toBeNull();
    expect(jiraBrowserLoginOrigin('http://firma.atlassian.net')).toBeNull();
    expect(jiraBrowserLoginOrigin('')).toBe(DEFAULT_JIRA_BASE_URL);
  });
});
