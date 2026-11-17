/** A Jira Cloud site authenticated with the Atlassian session cookie captured via interactive browser login. */
export type JiraConnection = {
  id: string;
  name: string;
  base_url: string;     // https://<site>.atlassian.net
  project_key: string;
  token: string;        // value of the tenant.session.token cookie
};

/** Atlassian Cloud session cookie set on the site host after an interactive login. */
export const JIRA_CLOUD_SESSION_COOKIE = 'tenant.session.token';

/** Connection id used by worklogs tracked before multiple connections existed (always on-prem, now removed). */
export const LEGACY_ONPREM_CONNECTION_ID = 'onprem';

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
  return {
    id,
    name: String(c['name'] ?? '').trim() || 'Jira Cloud',
    base_url: normalizeJiraBaseUrl(c['base_url']),
    // Project keys are interpolated into JQL, so only allow Jira's key alphabet.
    project_key: String(c['project_key'] ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, ''),
    token: String(c['token'] ?? '').trim()
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

/**
 * Upgrades stored connections from the multi-method format (type/auth/email):
 * on-prem connections are dropped, and Cloud API-token connections keep their site but lose the token,
 * because an API token is not a session cookie and the user must log in via browser once.
 */
export function migrateStoredJiraConnections(raw: unknown): JiraConnection[] {
  if (!Array.isArray(raw)) return [];
  const upgraded = raw.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return [];
    const c = entry as Record<string, unknown>;
    if (!('type' in c)) return [entry];
    if (c['type'] !== 'cloud') return [];
    return [{ ...c, token: c['auth'] === 'browser' ? c['token'] : '' }];
  });
  return normalizeJiraConnections(upgraded);
}

export function normalizeActiveJiraConnectionId(connections: JiraConnection[], activeId: unknown): string {
  const id = String(activeId ?? '').trim();
  if (connections.some((c) => c.id === id)) return id;
  return connections[0]?.id ?? '';
}

export function resolveJiraConnection(connections: JiraConnection[] | undefined, id: unknown): JiraConnection | undefined {
  const list = connections ?? [];
  const wanted = String(id ?? '').trim();
  return list.find((c) => c.id === wanted);
}

/**
 * Validates that a base URL can be used for an interactive Atlassian login and returns the site origin.
 * Scoped-token gateway URLs (api.atlassian.com) have no login page, so they are rejected.
 */
export function jiraBrowserLoginOrigin(rawBaseUrl: unknown): string | null {
  const base = normalizeJiraBaseUrl(rawBaseUrl);
  if (!base) return null;
  const url = new URL(base);
  if (url.hostname === 'api.atlassian.com') return null;
  return url.origin;
}

export function jiraConnectionMissingConfig(c: JiraConnection | undefined): string | null {
  if (!c) return 'Ingen aktiv Jira-forbindelse valgt i indstillinger.';
  if (!jiraBrowserLoginOrigin(c.base_url)) {
    return `Jira URL mangler eller er ugyldig for "${c.name}" (fx https://firma.atlassian.net).`;
  }
  if (!c.token) return `Log ind via browser mangler for "${c.name}".`;
  return null;
}

/** Escapes a value for use inside a double-quoted JQL string literal. */
export function escapeJqlString(value: string): string {
  return String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/[\\"]/g, '\\$&');
}

export function jiraApiBase(c: JiraConnection): string {
  return `${c.base_url}/rest/api/3`;
}

/** Requests carry no Authorization header; the session cookie is attached by the request session. */
export function jiraAuthHeaders(c: JiraConnection): Record<string, string> {
  // Jira's XSRF filter rejects cookie-authenticated writes from browser-like clients (Electron's default
  // "Mozilla/..." User-Agent) unless Origin matches the site, even with X-Atlassian-Token: no-check.
  const origin = jiraBrowserLoginOrigin(c.base_url);
  return {
    Accept: 'application/json',
    'X-Atlassian-Token': 'no-check',
    'User-Agent': 'JFLoggeR',
    ...(origin ? { Origin: origin } : {})
  };
}

export function buildJiraSearchUrl(c: JiraConnection, jql: string, fields: string[], maxResults: number): string {
  const params = `jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields.join(','))}&maxResults=${maxResults}`;
  // Jira Cloud removed /rest/api/{2,3}/search in favour of /search/jql.
  return `${jiraApiBase(c)}/search/jql?${params}`;
}

export function buildJiraMyselfUrl(c: JiraConnection): string {
  return `${jiraApiBase(c)}/myself`;
}

export function buildJiraWorklogUrl(c: JiraConnection, issueKey: string, worklogId?: string): string {
  const base = `${jiraApiBase(c)}/issue/${encodeURIComponent(issueKey)}/worklog`;
  return worklogId ? `${base}/${encodeURIComponent(worklogId)}?adjustEstimate=leave` : base;
}

export function buildJiraWorklogBody(seconds: number, started: string, comment: string) {
  // REST v3 requires comments in Atlassian Document Format.
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
  // Non-JSON bodies (e.g. Jira's plain-text "XSRF check failed") still carry the real reason.
  if (typeof body === 'string') {
    const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) messages.push(text.length > 200 ? `${text.slice(0, 200)}…` : text);
  }
  const detail = messages.filter(Boolean).join('; ');
  let hint = '';
  if (/xsrf/i.test(detail)) {
    hint = ' Jira afviste kaldet som cross-site (XSRF), så det er ikke et rettighedsproblem.';
  } else if (status === 401) {
    hint = ' Browser-sessionen er udløbet. Log ind igen via browser under Indstillinger.';
  } else if (status === 403) {
    hint = ' Tjek at din bruger har "Work on issues" i projektet.';
  }
  return `HTTP ${status}${detail ? ` - ${detail}` : ''}.${hint}`;
}

export function jiraUserIdFromMyself(data: { accountId?: unknown }): string | undefined {
  return String(data.accountId ?? '').trim() || undefined;
}
