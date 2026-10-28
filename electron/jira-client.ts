export type JiraDeployment = 'server' | 'cloud';

export type JiraConnection = {
  id: string;
  name: string;
  type: JiraDeployment;
  base_url: string;     // e.g. https://app-jira.corp.jyskebank.net/jira or https://<site>.atlassian.net
  project_key: string;
  token: string;        // server: PSA / personal access token (Bearer). cloud: API token (Basic with email)
  email: string;        // cloud only
};

export const LEGACY_ONPREM_CONNECTION_ID = 'onprem';
export const LEGACY_ONPREM_BASE_URL = 'https://app-jira.corp.jyskebank.net/jira';

export function normalizeJiraBaseUrl(raw: unknown): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return '';
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function normalizeJiraConnection(raw: unknown): JiraConnection | null {
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  const id = String(c['id'] ?? '').trim();
  if (!id) return null;
  const type: JiraDeployment = c['type'] === 'cloud' ? 'cloud' : 'server';
  return {
    id,
    name: String(c['name'] ?? '').trim() || (type === 'cloud' ? 'Jira Cloud' : 'Jira On-Premise'),
    type,
    base_url: normalizeJiraBaseUrl(c['base_url']),
    // Project keys are interpolated into JQL, so only allow Jira's key alphabet.
    project_key: String(c['project_key'] ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, ''),
    token: String(c['token'] ?? '').trim(),
    email: type === 'cloud' ? String(c['email'] ?? '').trim() : ''
  };
}

export function normalizeJiraConnections(raw: unknown): JiraConnection[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: JiraConnection[] = [];
  for (const entry of raw) {
    const c = normalizeJiraConnection(entry);
    if (!c || seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

export function normalizeActiveJiraConnectionId(connections: JiraConnection[], activeId: unknown): string {
  const id = String(activeId ?? '').trim();
  if (connections.some((c) => c.id === id)) return id;
  return connections[0]?.id ?? '';
}

/** Converts the pre-multi-connection settings (single on-prem PSA key) to a connection list. */
export function migrateLegacyJiraSettings(legacy: { jira_psa_key?: unknown; jira_project_key?: unknown }): JiraConnection[] {
  const token = String(legacy.jira_psa_key ?? '').trim();
  const projectKey = String(legacy.jira_project_key ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
  if (!token && !projectKey) return [];
  return [{
    id: LEGACY_ONPREM_CONNECTION_ID,
    name: 'Jira On-Premise',
    type: 'server',
    base_url: LEGACY_ONPREM_BASE_URL,
    project_key: projectKey,
    token,
    email: ''
  }];
}

export function resolveJiraConnection(connections: JiraConnection[] | undefined, id: unknown): JiraConnection | undefined {
  const list = connections ?? [];
  const wanted = String(id ?? '').trim();
  return list.find((c) => c.id === wanted);
}

export function jiraConnectionMissingConfig(c: JiraConnection | undefined): string | null {
  if (!c) return 'Ingen aktiv Jira-forbindelse valgt i indstillinger.';
  if (!c.base_url) return `Jira URL mangler eller er ugyldig for "${c.name}" (skal være https).`;
  if (!c.token) return c.type === 'cloud' ? `Jira API token mangler for "${c.name}".` : `Jira PSA key mangler for "${c.name}".`;
  if (c.type === 'cloud' && !c.email) return `Email mangler for Jira Cloud-forbindelsen "${c.name}".`;
  return null;
}

/** Escapes a value for use inside a double-quoted JQL string literal. */
export function escapeJqlString(value: string): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\"]/g, '\\$&');
}

export function jiraApiBase(c: JiraConnection): string {
  return `${c.base_url}/rest/api/${c.type === 'cloud' ? '3' : '2'}`;
}

export function jiraAuthHeaders(c: JiraConnection): Record<string, string> {
  const authorization = c.type === 'cloud'
    ? `Basic ${Buffer.from(`${c.email}:${c.token}`, 'utf8').toString('base64')}`
    : `Bearer ${c.token}`;
  return { Accept: 'application/json', Authorization: authorization };
}

export function buildJiraSearchUrl(c: JiraConnection, jql: string, fields: string[], maxResults: number): string {
  const params = `jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields.join(','))}&maxResults=${maxResults}`;
  // Jira Cloud removed /rest/api/{2,3}/search in favour of /search/jql.
  const path = c.type === 'cloud' ? 'search/jql' : 'search';
  return `${jiraApiBase(c)}/${path}?${params}`;
}

export function buildJiraMyselfUrl(c: JiraConnection): string {
  return `${jiraApiBase(c)}/myself`;
}

export function buildJiraWorklogUrl(c: JiraConnection, issueKey: string, worklogId?: string): string {
  const base = `${jiraApiBase(c)}/issue/${encodeURIComponent(issueKey)}/worklog`;
  return worklogId ? `${base}/${encodeURIComponent(worklogId)}?adjustEstimate=leave` : base;
}

export function buildJiraWorklogBody(c: JiraConnection, seconds: number, started: string, comment: string) {
  if (c.type === 'server') {
    return { timeSpentSeconds: seconds, started, comment };
  }
  // REST v3 (Cloud) requires comments in Atlassian Document Format.
  return {
    timeSpentSeconds: seconds,
    started,
    comment: {
      type: 'doc',
      version: 1,
      content: [{ type: 'paragraph', content: [{ type: 'text', text: comment }] }]
    }
  };
}

export function describeJiraHttpError(status: number, body: unknown): string {
  const b = (body && typeof body === 'object' ? body : {}) as { errorMessages?: unknown; errors?: unknown; message?: unknown };
  const messages: string[] = [];
  if (Array.isArray(b.errorMessages)) messages.push(...b.errorMessages.map(String));
  if (b.errors && typeof b.errors === 'object') messages.push(...Object.values(b.errors as Record<string, unknown>).map(String));
  if (typeof b.message === 'string') messages.push(b.message);
  const detail = messages.filter(Boolean).join('; ');
  const hint = status === 401 || status === 403
    ? ' Tjek at token har scope write:jira-work og at din bruger har "Work on issues" i projektet.'
    : '';
  return `HTTP ${status}${detail ? ` - ${detail}` : ''}.${hint}`;
}

export function jiraUserIdFromMyself(c: JiraConnection, data: { accountId?: unknown; key?: unknown; name?: unknown }): string | undefined {
  const raw = c.type === 'cloud'
    ? data.accountId
    : (data.accountId ?? data.key ?? data.name);
  return String(raw ?? '').trim() || undefined;
}
