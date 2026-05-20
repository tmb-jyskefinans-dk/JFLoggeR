"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mapAndRankJiraIssues = mapAndRankJiraIssues;
function normalizeJiraUser(raw) {
    if (!raw || typeof raw !== 'object')
        return null;
    const candidate = raw;
    const accountId = String(candidate.accountId ?? candidate.key ?? candidate.name ?? '').trim();
    if (!accountId)
        return null;
    return {
        accountId,
        displayName: String(candidate.displayName ?? candidate.name ?? '').trim()
    };
}
function normalizeJiraUsers(raw) {
    if (!Array.isArray(raw))
        return [];
    const users = [];
    for (const entry of raw) {
        const user = normalizeJiraUser(entry);
        if (!user)
            continue;
        users.push(user);
    }
    return users;
}
function relevanceScore(issueKey, summary, term) {
    const keyUpper = issueKey.toUpperCase();
    const summaryUpper = summary.toUpperCase();
    const termUpper = term.trim().toUpperCase();
    if (!termUpper)
        return 99;
    if (keyUpper === termUpper)
        return 0;
    if (keyUpper.startsWith(termUpper))
        return 1;
    if (summaryUpper.startsWith(termUpper))
        return 2;
    if (summaryUpper.includes(termUpper))
        return 3;
    return 4;
}
function roleRank(item) {
    if (item.isCurrentUserAssignee)
        return 0;
    if (item.isCurrentUserCoAssignee)
        return 1;
    if (item.isCurrentUserReporter)
        return 2;
    return 3;
}
function mapAndRankJiraIssues(issues, term, currentAccountId) {
    const me = String(currentAccountId ?? '').trim();
    const mapped = issues
        .map((issue, index) => {
        const key = String(issue.key ?? '').trim().toUpperCase();
        const fields = issue.fields;
        const summary = String(fields?.summary ?? '').trim();
        if (!key || !summary)
            return null;
        const assignee = normalizeJiraUser(fields?.assignee);
        const reporter = normalizeJiraUser(fields?.reporter);
        const coAssignees = normalizeJiraUsers(fields?.customfield_10060);
        const coAssigneeAccountIds = coAssignees.map((user) => user.accountId);
        const suggestion = {
            key,
            summary,
            iconUrl: String(fields?.issuetype?.iconUrl ?? '').trim(),
            assigneeAccountId: assignee?.accountId ?? '',
            assigneeDisplayName: assignee?.displayName ?? '',
            reporterAccountId: reporter?.accountId ?? '',
            reporterDisplayName: reporter?.displayName ?? '',
            coAssigneeAccountIds,
            coAssigneeDisplayNames: coAssignees.map((user) => user.displayName).filter((name) => !!name),
            isCurrentUserAssignee: !!me && assignee?.accountId === me,
            isCurrentUserCoAssignee: !!me && coAssigneeAccountIds.includes(me),
            isCurrentUserReporter: !!me && reporter?.accountId === me
        };
        return {
            item: suggestion,
            role: roleRank(suggestion),
            relevance: relevanceScore(suggestion.key, suggestion.summary, term),
            index
        };
    })
        .filter((entry) => !!entry);
    mapped.sort((a, b) => {
        if (a.role !== b.role)
            return a.role - b.role;
        if (a.relevance !== b.relevance)
            return a.relevance - b.relevance;
        return a.index - b.index;
    });
    return mapped.map((entry) => entry.item);
}
//# sourceMappingURL=jira-search.js.map