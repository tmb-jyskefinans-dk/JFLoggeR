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

export function shouldJiraAutoLogOnAfstem(settings: unknown): boolean {
  const s = (settings ?? {}) as { jira_log_on_afstem?: unknown; jira_psa_key?: unknown };
  return !!s.jira_log_on_afstem && !!String(s.jira_psa_key ?? '').trim();
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
