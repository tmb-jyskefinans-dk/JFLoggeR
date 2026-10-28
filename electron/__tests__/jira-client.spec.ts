import {
  buildJiraSearchUrl,
  buildJiraWorklogBody,
  buildJiraWorklogUrl,
  describeJiraHttpError,
  jiraAuthHeaders,
  jiraConnectionMissingConfig,
  jiraUserIdFromMyself,
  migrateLegacyJiraSettings,
  normalizeActiveJiraConnectionId,
  normalizeJiraConnection,
  normalizeJiraConnections,
  LEGACY_ONPREM_BASE_URL,
  LEGACY_ONPREM_CONNECTION_ID,
  type JiraConnection
} from '../jira-client';

const onprem: JiraConnection = {
  id: 'onprem',
  name: 'On-prem',
  type: 'server',
  base_url: 'https://jira.corp.local/jira',
  project_key: 'ABC',
  token: 'psa',
  email: ''
};

const cloud: JiraConnection = {
  id: 'cloud',
  name: 'Cloud',
  type: 'cloud',
  base_url: 'https://firma.atlassian.net',
  project_key: 'ABC',
  token: 'api-token',
  email: 'me@firma.dk'
};

describe('jira-client', () => {
  test('migrates legacy on-prem settings into a connection', () => {
    const [c] = migrateLegacyJiraSettings({ jira_psa_key: ' psa ', jira_project_key: 'abc' });
    expect(c.id).toBe(LEGACY_ONPREM_CONNECTION_ID);
    expect(c.type).toBe('server');
    expect(c.base_url).toBe(LEGACY_ONPREM_BASE_URL);
    expect(c.token).toBe('psa');
    expect(c.project_key).toBe('ABC');
    expect(migrateLegacyJiraSettings({}).length).toBe(0);
  });

  test('normalizes connections and rejects non-https urls', () => {
    const c = normalizeJiraConnection({ id: 'x', type: 'cloud', base_url: 'https://firma.atlassian.net/', project_key: 'abc', email: ' a@b.dk ' });
    expect(c?.base_url).toBe('https://firma.atlassian.net');
    expect(c?.project_key).toBe('ABC');
    expect(c?.email).toBe('a@b.dk');
    expect(normalizeJiraConnection({ id: 'y', base_url: 'http://insecure' })?.base_url).toBe('');
    expect(normalizeJiraConnection({ name: 'no id' })).toBeNull();
    expect(normalizeJiraConnections([{ id: 'a' }, { id: 'a' }, null]).length).toBe(1);
  });

  test('falls back to first connection when active id is unknown', () => {
    expect(normalizeActiveJiraConnectionId([onprem, cloud], 'cloud')).toBe('cloud');
    expect(normalizeActiveJiraConnectionId([onprem, cloud], 'gone')).toBe('onprem');
    expect(normalizeActiveJiraConnectionId([], 'gone')).toBe('');
  });

  test('reports missing config per deployment type', () => {
    expect(jiraConnectionMissingConfig(undefined)).toBeTruthy();
    expect(jiraConnectionMissingConfig(onprem)).toBeNull();
    expect(jiraConnectionMissingConfig(cloud)).toBeNull();
    expect(jiraConnectionMissingConfig({ ...cloud, email: '' })).toContain('Email');
    expect(jiraConnectionMissingConfig({ ...onprem, token: '' })).toContain('PSA');
  });

  test('uses Bearer for on-prem and Basic for cloud', () => {
    expect(jiraAuthHeaders(onprem).Authorization).toBe('Bearer psa');
    const expected = Buffer.from('me@firma.dk:api-token').toString('base64');
    expect(jiraAuthHeaders(cloud).Authorization).toBe(`Basic ${expected}`);
  });

  test('builds API v2 search for on-prem and v3 search/jql for cloud', () => {
    expect(buildJiraSearchUrl(onprem, 'project = ABC', ['key', 'summary'], 10))
      .toBe('https://jira.corp.local/jira/rest/api/2/search?jql=project%20%3D%20ABC&fields=key%2Csummary&maxResults=10');
    expect(buildJiraSearchUrl(cloud, 'project = ABC', ['key'], 5))
      .toBe('https://firma.atlassian.net/rest/api/3/search/jql?jql=project%20%3D%20ABC&fields=key&maxResults=5');
  });

  test('builds worklog urls and bodies for each deployment', () => {
    expect(buildJiraWorklogUrl(onprem, 'ABC-1')).toBe('https://jira.corp.local/jira/rest/api/2/issue/ABC-1/worklog');
    expect(buildJiraWorklogUrl(cloud, 'ABC-1', '42')).toBe('https://firma.atlassian.net/rest/api/3/issue/ABC-1/worklog/42?adjustEstimate=leave');

    const serverBody = buildJiraWorklogBody(onprem, 900, '2026-01-01T08:00:00.000+0100', 'hi');
    expect(serverBody.comment).toBe('hi');

    const cloudBody = buildJiraWorklogBody(cloud, 900, '2026-01-01T08:00:00.000+0100', 'hi') as { comment: { type: string; content: Array<{ content: Array<{ text: string }> }> } };
    expect(cloudBody.comment.type).toBe('doc');
    expect(cloudBody.comment.content[0].content[0].text).toBe('hi');
  });

  test('describes Jira HTTP errors with body details and scope hint', () => {
    const msg = describeJiraHttpError(401, { errorMessages: ['Unauthorized; scope does not match'] });
    expect(msg).toContain('HTTP 401');
    expect(msg).toContain('scope does not match');
    expect(msg).toContain('write:jira-work');
    expect(describeJiraHttpError(400, { errors: { timeSpent: 'Invalid' } })).toBe('HTTP 400 - Invalid.');
    expect(describeJiraHttpError(500, undefined)).toBe('HTTP 500.');
  });

  test('resolves user id from /myself per deployment', () => {
    expect(jiraUserIdFromMyself(onprem, { key: 'JD0060', name: 'jd' })).toBe('JD0060');
    expect(jiraUserIdFromMyself(cloud, { accountId: '5b10a', key: 'ignored' })).toBe('5b10a');
    expect(jiraUserIdFromMyself(cloud, { key: 'only-key' })).toBeUndefined();
  });
});
