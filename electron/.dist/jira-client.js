"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_ONPREM_BASE_URL = exports.LEGACY_ONPREM_CONNECTION_ID = void 0;
exports.normalizeJiraBaseUrl = normalizeJiraBaseUrl;
exports.normalizeJiraConnection = normalizeJiraConnection;
exports.normalizeJiraConnections = normalizeJiraConnections;
exports.normalizeActiveJiraConnectionId = normalizeActiveJiraConnectionId;
exports.migrateLegacyJiraSettings = migrateLegacyJiraSettings;
exports.resolveJiraConnection = resolveJiraConnection;
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
exports.LEGACY_ONPREM_CONNECTION_ID = 'onprem';
exports.LEGACY_ONPREM_BASE_URL = 'https://app-jira.corp.jyskebank.net/jira';
function normalizeJiraBaseUrl(raw) {
    const value = String(raw ?? '').trim();
    if (!value)
        return '';
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
    const type = c['type'] === 'cloud' ? 'cloud' : 'server';
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
function normalizeActiveJiraConnectionId(connections, activeId) {
    const id = String(activeId ?? '').trim();
    if (connections.some((c) => c.id === id))
        return id;
    return connections[0]?.id ?? '';
}
/** Converts the pre-multi-connection settings (single on-prem PSA key) to a connection list. */
function migrateLegacyJiraSettings(legacy) {
    const token = String(legacy.jira_psa_key ?? '').trim();
    const projectKey = String(legacy.jira_project_key ?? '').toUpperCase().replace(/[^A-Z0-9_]/g, '');
    if (!token && !projectKey)
        return [];
    return [{
            id: exports.LEGACY_ONPREM_CONNECTION_ID,
            name: 'Jira On-Premise',
            type: 'server',
            base_url: exports.LEGACY_ONPREM_BASE_URL,
            project_key: projectKey,
            token,
            email: ''
        }];
}
function resolveJiraConnection(connections, id) {
    const list = connections ?? [];
    const wanted = String(id ?? '').trim();
    return list.find((c) => c.id === wanted);
}
function jiraConnectionMissingConfig(c) {
    if (!c)
        return 'Ingen aktiv Jira-forbindelse valgt i indstillinger.';
    if (!c.base_url)
        return `Jira URL mangler eller er ugyldig for "${c.name}" (skal være https).`;
    if (!c.token)
        return c.type === 'cloud' ? `Jira API token mangler for "${c.name}".` : `Jira PSA key mangler for "${c.name}".`;
    if (c.type === 'cloud' && !c.email)
        return `Email mangler for Jira Cloud-forbindelsen "${c.name}".`;
    return null;
}
/** Escapes a value for use inside a double-quoted JQL string literal. */
function escapeJqlString(value) {
    return String(value ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/[\\"]/g, '\\$&');
}
function jiraApiBase(c) {
    return `${c.base_url}/rest/api/${c.type === 'cloud' ? '3' : '2'}`;
}
function jiraAuthHeaders(c) {
    const authorization = c.type === 'cloud'
        ? `Basic ${Buffer.from(`${c.email}:${c.token}`, 'utf8').toString('base64')}`
        : `Bearer ${c.token}`;
    return { Accept: 'application/json', Authorization: authorization };
}
function buildJiraSearchUrl(c, jql, fields, maxResults) {
    const params = `jql=${encodeURIComponent(jql)}&fields=${encodeURIComponent(fields.join(','))}&maxResults=${maxResults}`;
    // Jira Cloud removed /rest/api/{2,3}/search in favour of /search/jql.
    const path = c.type === 'cloud' ? 'search/jql' : 'search';
    return `${jiraApiBase(c)}/${path}?${params}`;
}
function buildJiraMyselfUrl(c) {
    return `${jiraApiBase(c)}/myself`;
}
function buildJiraWorklogUrl(c, issueKey, worklogId) {
    const base = `${jiraApiBase(c)}/issue/${encodeURIComponent(issueKey)}/worklog`;
    return worklogId ? `${base}/${encodeURIComponent(worklogId)}?adjustEstimate=leave` : base;
}
function buildJiraWorklogBody(c, seconds, started, comment) {
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
function describeJiraHttpError(status, body) {
    const b = (body && typeof body === 'object' ? body : {});
    const messages = [];
    if (Array.isArray(b.errorMessages))
        messages.push(...b.errorMessages.map(String));
    if (b.errors && typeof b.errors === 'object')
        messages.push(...Object.values(b.errors).map(String));
    if (typeof b.message === 'string')
        messages.push(b.message);
    const detail = messages.filter(Boolean).join('; ');
    const hint = status === 401 || status === 403
        ? ' Tjek at token har scope write:jira-work og at din bruger har "Work on issues" i projektet.'
        : '';
    return `HTTP ${status}${detail ? ` - ${detail}` : ''}.${hint}`;
}
function jiraUserIdFromMyself(c, data) {
    const raw = c.type === 'cloud'
        ? data.accountId
        : (data.accountId ?? data.key ?? data.name);
    return String(raw ?? '').trim() || undefined;
}
//# sourceMappingURL=jira-client.js.map