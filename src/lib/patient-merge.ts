export type PatientMergeCandidate = {
  id: string;
  organizationId: string;
  status: string;
  mergedIntoPatientId: string | null;
  portalAccount: { id: string } | null;
};

export function patientMergeEligibility(
  source: PatientMergeCandidate,
  target: PatientMergeCandidate,
) {
  if (source.id === target.id) {
    return { ok: false as const, error: "same_patient" };
  }
  if (source.organizationId !== target.organizationId) {
    return { ok: false as const, error: "organization_mismatch" };
  }
  if (source.status !== "ACTIVE" || source.mergedIntoPatientId) {
    return { ok: false as const, error: "source_not_mergeable" };
  }
  if (target.status !== "ACTIVE" || target.mergedIntoPatientId) {
    return { ok: false as const, error: "target_not_canonical" };
  }
  if (source.portalAccount && target.portalAccount) {
    return { ok: false as const, error: "portal_account_conflict" };
  }
  return { ok: true as const };
}
