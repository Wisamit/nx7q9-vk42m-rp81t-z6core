/**
 * Resolve legacy TEST -> PANEL memberships only from safe-master source rows
 * that have an exact transaction-local test identity. Never join by test name:
 * two distinct tests can share a display name.
 */
type ImportRow = {
  id: string;
  entityType: string;
  status: string;
  validationIssues: unknown;
  normalizedData: unknown;
};

const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

export function isSafeMasterTestRow(
  row: Pick<ImportRow, "entityType" | "status" | "validationIssues">,
): boolean {
  if (row.entityType !== "TEST") return false;
  if (row.status === "VALID") return true;
  if (row.status !== "WARNING" || !Array.isArray(row.validationIssues)) return false;
  const issues = row.validationIssues;
  return issues.length === 1 && issues.every(issue =>
    issue !== null && typeof issue === "object" && !Array.isArray(issue) &&
    (issue as Record<string, unknown>).code === "GENERATED_TEST_CODE");
}

export function sameImportTestIdentity(existingName: string, sourceName: string): boolean {
  return !!existingName.trim() && !!sourceName.trim() &&
    existingName.trim().toUpperCase() === sourceName.trim().toUpperCase();
}

/** Conflicting panel aliases stay ambiguous even if later rows repeat a prior ID. */
export function registerPanelAlias(
  aliases: Map<string, string | null>, rawAlias: string, panelId: string,
): void {
  const alias = rawAlias.trim().toUpperCase();
  if (!alias || !panelId) return;
  if (!aliases.has(alias)) aliases.set(alias, panelId);
  else if (aliases.get(alias) !== panelId) aliases.set(alias, null);
}

export function resolvedPanelMemberships(
  rows: readonly ImportRow[],
  testBySourceRowId: ReadonlyMap<string, string>,
  panelAliases: ReadonlyMap<string, string | null>,
): Array<{ panelId: string; testId: string; displayOrder: number; required: true }> {
  const links: Array<{ panelId: string; testId: string; displayOrder: number; required: true }> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!isSafeMasterTestRow(row)) continue;
    const testId = testBySourceRowId.get(row.id);
    const panel = text(record(row.normalizedData).panel);
    if (!testId || !panel) continue;
    const literalKey = panel.toUpperCase();
    const normalizedKey = panel.replace(/\s+/g, "_").toUpperCase();
    const direct = panelAliases.get(literalKey);
    const normalized = panelAliases.get(normalizedKey);
    // A conflicting literal/normalized alias must not silently pick one.
    if (panelAliases.has(literalKey) && panelAliases.has(normalizedKey) &&
        direct !== normalized) continue;
    const panelId = panelAliases.has(literalKey) ? direct : normalized;
    if (!panelId) continue;
    const key = panelId + "|" + testId;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ panelId, testId, displayOrder: 0, required: true });
  }
  return links;
}
