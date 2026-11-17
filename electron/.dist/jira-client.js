"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_JIRA_BASE_URL = exports.LEGACY_ONPREM_CONNECTION_ID = exports.JIRA_CLOUD_SESSION_COOKIE = void 0;
exports.normalizeJiraBaseUrl = normalizeJiraBaseUrl;
exports.normalizeJiraConnection = normalizeJiraConnection;
exports.normalizeJiraConnections = normalizeJiraConnections;
exports.migrateStoredJiraConnections = migrateStoredJiraConnections;
exports.normalizeActiveJiraConnectionId = normalizeActiveJiraConnectionId;
exports.resolveJiraConnection = resolveJiraConnection;
exports.jiraBrowserLoginOrigin = jiraBrowserLoginOrigin;
exports.jiraConnectionMissingConfig = jiraConnectionMissingConfig;
exports.escapeJqlString = escapeJqlString;
exports.jiraApiBase = jiraApiBase;
exports.jiraAuthHeaders = jiraAuthHeaders;
exports.buildJiraSearchUrl = buildJiraSearchUrl;
exports.buildJiraMyselfUrl = buildJiraMyselfUrl;
exports.buildJiraWorklogUrl = buildJiraWorklogUrl;
exports.buildJiraWorklogBody = buildJiraWorklogBody;
exports.describeJiraHttpError = describeJiraHttpError;
exports.jiraUserIdFromMyself = jiraUserIdFromMyself;
/** Atlassian Cloud session cookie set on the site host after an interactive login. */
exports.JIRA_CLOUD_SESSION_COOKIE = 'tenant.session.token';
/** Connection id used by worklogs tracked before multiple connections existed (always on-prem, now removed). */
exports.LEGACY_ONPREM_CONNECTION_ID = 'onprem';
/** Used when no Jira URL is entered. */
exports.DEFAULT_JIRA_BASE_URL = 'https://jyskebank.atlassian.net';
function normalizeJiraBaseUrl(raw) {
    const value = String(raw ?? '').trim() || exports.DEFAULT_JIRA_BASE_URL;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:')
            return '';
        return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
    }
    catch {
        return '';
    }
}
function normalizeJiraConnection(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const c = raw;
    const id = String(c['id'] ?? '').trim();
    if (!id)
        return null;
    return {
        id,
        name: String(c['name'] ?? '').trim() || 'Jira Cloud',
        base_url: normalizeJiraBaseUrl(c['base_url']),
        // Project keys are interpolated into JQL, so only allow Jira's key alphabet.
        project_key: String(c['project_key'] ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, ''),
        token: String(c['token'] ?? '').trim()
    };
}
function normalizeJiraConnections(raw) {
    if (!Array.isArray(raw))
        return [];
    const seen = new Set();
    const out = [];
    for (const entry of raw) {
        const c = normalizeJiraConnection(entry);
        if (!c || seen.has(c.id))
            continue;
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
function migrateStoredJiraConnections(raw) {
    if (!Array.isArray(raw))
        return [];
    const upgraded = raw.flatMap((entry) => {
        if (!entry || typeof entry !== 'object')
            return [];
        const c = entry;
        if (!('type' in c))
            return [entry];
        if (c['type'] !== 'cloud')
            return [];
        return [{ ...c, token: c['auth'] === 'browser' ? c['token'] : '' }];
    });
    return normalizeJiraConnections(upgraded);
}
function normalizeActiveJiraConnectionId(connections, activeId) {
    const id = String(activeId ?? '').trim();
    if (connections.some((c) => c.id === id))
        return id;
    return connections[0]?.id ?? '';
}
function resolveJiraConnection(connections, id) {
    const list = connections ?? [];
    const wanted = String(id ?? '').trim();
    return list.find((c) => c.id === wanted);
}
/**
 * Validates that a base URL can be used for an interactive Atlassian login and returns the site origin.
 * Scoped-token gateway URLs (api.atlassian.com) have no login page, so they are rejected.
 */
function jiraBrowserLoginOrigin(rawBaseUrl) {
    const base = normalizeJiraBaseUrl(rawBaseUrl);
    if (!base)
        return null;
    const url = new URL(base);
    if (url.hostname === 'api.atlassian.com')
        return null;
    return url.origin;
}
function jiraConnectionMissingConfig(c) {
    if (!c)
        return 'Ingen aktiv Jira-forbindelse valgt i indstillinger.';
    if (!jiraBrowserLoginOrigin(c.base_url)) {
        return `Jira URL mangler eller er ugyldig for "${c.name}" (fx https://firma.atlassian.net).`;
    }
    if (!c.token)
        return `Log ind via browser mangler for "${c.name}".`;
    return null;
}
/** Escapes a value for use inside a double-quoted JQL string literal. */
function escapeJqlString(value) {
    return String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/[\\"]/g, '\\$&');
}
function jiraApiBase(c) {
    return `${c.base_url}/rest/api/3`;
}
/** Requests carry no Authorization header; the session cookie is attached by the request session. */
function jiraAuthHeaders(c) {
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
function buildJiraSearchUrl(c, jql, fields, maxResults) {
    const params = `jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields.join(','))}&maxResults=${maxResults}`;
    // Jira Cloud removed /rest/api/{2,3}/search in favour of /search/jql.
    return `${jiraApiBase(c)}/search/jql?${params}`;
}
function buildJiraMyselfUrl(c) {
    return `${jiraApiBase(c)}/myself`;
}
function buildJiraWorklogUrl(c, issueKey, worklogId) {
    const base = `${jiraApiBase(c)}/issue/${encodeURIComponent(issueKey)}/worklog`;
    return worklogId ? `${base}/${encodeURIComponent(worklogId)}?adjustEstimate=leave` : base;
}
function buildJiraWorklogBody(seconds, started, comment) {
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
function describeJiraHttpError(status, body) {
    const b = (body && typeof body === 'object' ? body : {});
    const messages = [];
    if (Array.isArray(b.errorMessages))
        messages.push(...b.errorMessages.map(String));
    if (b.errors && typeof b.errors === 'object')
        messages.push(...Object.values(b.errors).map(String));
    if (typeof b.message === 'string')
        messages.push(b.message);
    // Non-JSON bodies (e.g. Jira's plain-text "XSRF check failed") still carry the real reason.
    if (typeof body === 'string') {
        const text = body.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        if (text)
            messages.push(text.length > 200 ? `${text.slice(0, 200)}…` : text);
    }
    const detail = messages.filter(Boolean).join('; ');
    let hint = '';
    if (/xsrf/i.test(detail)) {
        hint = ' Jira afviste kaldet som cross-site (XSRF), så det er ikke et rettighedsproblem.';
    }
    else if (status === 401) {
        hint = ' Browser-sessionen er udløbet. Log ind igen via browser under Indstillinger.';
    }
    else if (status === 403) {
        hint = ' Tjek at din bruger har "Work on issues" i projektet.';
    }
    return `HTTP ${status}${detail ? ` - ${detail}` : ''}.${hint}`;
}
function jiraUserIdFromMyself(data) {
    return String(data.accountId ?? '').trim() || undefined;
}
//# sourceMappingURL=jira-client.js.map