import { bundleTriageClass, type TriageClass } from "./catalog-drift-triage.ts";
import type { FindingLifecycle } from "./catalog-finding-lifecycle.ts";

export type GovernanceRow = {
  entityType: string;
  disposition: "UNCHANGED" | "DRIFTED";
  finding: { status: FindingLifecycle };
};
export type GovernanceCount = {
  total: number; unchanged: number; drifted: number;
  unflagged: number; driftUnflagged: number; pending: number; expertConfirmed: number;
  returnedForCorrection: number; stale: number;
};
export type GovernanceBlocker =
  | "SIGNATORY_POLICY_UNCONFIGURED"
  | "APPLICATION_WORKFLOW_UNAVAILABLE"
  | "SOURCE_NOT_ATTESTED"
  | "DRIFT_NOT_TRIAGED"
  | "EXPERT_REVIEW_PENDING"
  | "EXPERT_RETURNED_FOR_CORRECTION"
  | "STALE_REVIEW_EVIDENCE";
const empty = (): GovernanceCount => ({
  total: 0, unchanged: 0, drifted: 0,
  unflagged: 0, driftUnflagged: 0, pending: 0, expertConfirmed: 0,
  returnedForCorrection: 0, stale: 0,
});

/**
 * Descriptive governance preflight, NOT a regulatory/clinical approval.
 * Even an entirely reviewed source cannot become eligible for activation
 * until approved signatory policy and immutable application are implemented.
 * Counts only: no clinical limits, prices, patient details or source JSON.
 */
export function summarizeCatalogGovernance(rows: readonly GovernanceRow[], sourceAttested: boolean) {
  const byCategory: Record<TriageClass, GovernanceCount> = {
    CLINICAL: empty(), FINANCIAL: empty(), CROSS_DOMAIN: empty(), CATALOG: empty(),
  };
  const totals = empty();
  for (const row of rows) {
    const category = bundleTriageClass(row.entityType);
    if (!category) throw new Error("governance_unknown_entity_type");
    if (!["UNCHANGED", "DRIFTED"].includes(row.disposition)) {
      throw new Error("governance_unknown_disposition");
    }
    const status = row.finding.status;
    if (!["UNFLAGGED", "AWAITING_EXPERT", "EXPERT_CONFIRMED",
      "RETURNED_FOR_CORRECTION", "STALE_REVIEW_REQUIRED"].includes(status)) {
      throw new Error("governance_unknown_finding");
    }
    for (const bucket of [byCategory[category], totals]) {
      bucket.total++;
      if (row.disposition === "DRIFTED") bucket.drifted++;
      else bucket.unchanged++;
      if (status === "UNFLAGGED") {
        bucket.unflagged++;
        if (row.disposition === "DRIFTED") bucket.driftUnflagged++;
      }
      else if (status === "AWAITING_EXPERT") bucket.pending++;
      else if (status === "EXPERT_CONFIRMED") bucket.expertConfirmed++;
      else if (status === "RETURNED_FOR_CORRECTION") bucket.returnedForCorrection++;
      else bucket.stale++;
    }
  }
  const blockers: GovernanceBlocker[] = [
    "SIGNATORY_POLICY_UNCONFIGURED", "APPLICATION_WORKFLOW_UNAVAILABLE",
  ];
  if (!sourceAttested) blockers.push("SOURCE_NOT_ATTESTED");
  if (totals.driftUnflagged > 0) blockers.push("DRIFT_NOT_TRIAGED");
  if (totals.pending > 0) blockers.push("EXPERT_REVIEW_PENDING");
  if (totals.returnedForCorrection > 0) blockers.push("EXPERT_RETURNED_FOR_CORRECTION");
  if (totals.stale > 0) blockers.push("STALE_REVIEW_EVIDENCE");
  return {
    rowCount: totals.total, sourceAttested,
    byCategory, totals, blockers,
    reviewOnly: true, approved: false,
    activationAllowed: false, clinicalReleaseAllowed: false,
    pricePublicationAllowed: false, liveWrites: false,
  } as const;
}
