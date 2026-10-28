export interface JiraAfstemSummaryRow {
  description: string;
  category: string;
  minutes: number;
}

const JIRA_AFSTEM_CATEGORIES = new Set([
  'Udvikling (prioriterede jf. projektoversigten)',
  'Estimering'
]);

const JIRA_KEY_PREFIX = /^[A-Z]+-\d+\s*-\s*/;

type JiraConnectionLike = { id?: unknown; name?: unknown; type?: unknown; base_url?: unknown; token?: unknown; email?: unknown };

export function getActiveJiraConnection(settings: unknown): JiraConnectionLike | undefined {
  const s = (settings ?? {}) as { jira_connections?: unknown; jira_active_connection_id?: unknown };
  if (!Array.isArray(s.jira_connections)) return undefined;
  const activeId = String(s.jira_active_connection_id ?? '');
  return (s.jira_connections as JiraConnectionLike[]).find((c) => !!c && String(c.id ?? '') === activeId);
}

export function isJiraConnectionUsable(c: JiraConnectionLike | null | undefined): boolean {
  if (!c) return false;
  if (!String(c.base_url ?? '').trim() || !String(c.token ?? '').trim()) return false;
  return c.type !== 'cloud' || !!String(c.email ?? '').trim();
}

export function shouldJiraAutoLogOnAfstem(settings: unknown): boolean {
  const s = (settings ?? {}) as { jira_log_on_afstem?: unknown };
  return !!s.jira_log_on_afstem && isJiraConnectionUsable(getActiveJiraConnection(settings));
}

export function isJiraAfstemRow(row: { description?: string; category?: string } | null | undefined): boolean {
  if (!row) return false;
  const category = String(row.category ?? '');
  const description = String(row.description ?? '');
  return JIRA_AFSTEM_CATEGORIES.has(category) && JIRA_KEY_PREFIX.test(description);
}

export function getJiraAfstemRows<T extends { description?: string; category?: string }>(rows: T[]): T[] {
  return (rows ?? []).filter((row) => isJiraAfstemRow(row));
}
