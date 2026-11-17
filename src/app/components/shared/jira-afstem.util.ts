export interface JiraAfstemSummaryRow {
  description: string;
  category: string;
  minutes: number;
}

const JIRA_KEY_PREFIX = /^[A-Z]+-\d+\s*-\s*/;

type JiraConnectionLike = { id?: unknown; name?: unknown; base_url?: unknown; token?: unknown };

export function getActiveJiraConnection(settings: unknown): JiraConnectionLike | undefined {
  const s = (settings ?? {}) as { jira_connections?: unknown; jira_active_connection_id?: unknown };
  if (!Array.isArray(s.jira_connections)) return undefined;
  const activeId = String(s.jira_active_connection_id ?? '');
  return (s.jira_connections as JiraConnectionLike[]).find((c) => !!c && String(c.id ?? '') === activeId);
}

export function isJiraConnectionUsable(c: JiraConnectionLike | null | undefined): boolean {
  if (!c) return false;
  // A blank URL falls back to the default Jira Cloud site, so only the browser login is required.
  return !!String(c.token ?? '').trim();
}

export function shouldJiraAutoLogOnAfstem(settings: unknown): boolean {
  const s = (settings ?? {}) as { jira_log_on_afstem?: unknown };
  return !!s.jira_log_on_afstem && isJiraConnectionUsable(getActiveJiraConnection(settings));
}

export function isJiraAfstemRow(row: { description?: string; category?: string } | null | undefined): boolean {
  if (!row) return false;
  return JIRA_KEY_PREFIX.test(String(row.description ?? ''));
}

export function getJiraAfstemRows<T extends { description?: string; category?: string }>(rows: T[]): T[] {
  return (rows ?? []).filter((row) => isJiraAfstemRow(row));
}
