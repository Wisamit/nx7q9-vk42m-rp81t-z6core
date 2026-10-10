/**
 * Read-only component import responses must not expose already processed,
 * invalid or out-of-scope clinical source values through reconciliation.
 */
export type StagedComponentReviewStatus = string;

export function isReviewableComponentStatus(status: StagedComponentReviewStatus): boolean {
  return status === "VALID" || status === "WARNING";
}

export function blockedComponentReviewRow(
  row: { rowNumber: number; status: string },
  issue?: "PARENT_TEST_NOT_ACTIVE_OR_MISSING",
) {
  const reason = issue ?? (row.status === "IMPORTED" || row.status === "SKIPPED"
    ? "ROW_ALREADY_PROCESSED" : "STAGED_ROW_HAS_ERRORS");
  return {
    rowNumber: row.rowNumber,
    rowStatus: row.status,
    candidate: null,
    disposition: "BLOCKED" as const,
    issues: [reason],
    stagedIssues: [],
    resolvedTestId: null,
    resolvedUnitId: null,
  };
}

export function componentCsvReviewAllowed(
  batch: { sourceType: string; createdByUserId: string },
  actorUserId: string,
): boolean {
  // Other source types retain the legacy catalog-scoped review policy.
  return batch.sourceType !== "CSV_REVIEW" || batch.createdByUserId === actorUserId;
}
