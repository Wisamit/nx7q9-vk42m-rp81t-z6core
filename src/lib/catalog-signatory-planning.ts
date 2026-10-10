export type ReviewCandidate = {
  id: string;
  status: "ACTIVE" | string;
  mfaEnabled: boolean;
  activeBranchIds: readonly string[];
  hasRestrictedDepartments: boolean;
  hasActiveApplicableDepartment: boolean;
  permissions: ReadonlySet<string>;
};

export type SignatoryPlanningGap =
  | "FORMAL_SIGNATORY_ROLES_NOT_ESTABLISHED"
  | "SIGNATURE_AUTHENTICATION_POLICY_UNDEFINED"
  | "SIGNATURE_EVIDENCE_AND_VERSIONED_APPLICATION_NOT_IMPLEMENTED"
  | "NO_INDEPENDENT_CLINICAL_REVIEW_CANDIDATE"
  | "NO_INDEPENDENT_FINANCIAL_REVIEW_CANDIDATE"
  | "NO_TWO_DISTINCT_CROSS_DOMAIN_REVIEWERS";

/**
 * Capability-only planning. Existing manage grants are not a signing
 * qualification, and no one is granted approval power by this assessment.
 */
export function summarizeSignatoryPlanning(input: {
  candidates: readonly ReviewCandidate[];
  branchId: string;
  authorId: string;
}) {
  const clinical: string[] = [];
  const financial: string[] = [];
  const withMfa = new Set<string>();
  const seen = new Set<string>();

  for (const candidate of input.candidates) {
    if (seen.has(candidate.id)) throw new Error("signatory_planning_duplicate_user");
    seen.add(candidate.id);
    if (candidate.status !== "ACTIVE" || candidate.id === input.authorId ||
        !candidate.activeBranchIds.includes(input.branchId) ||
        (candidate.hasRestrictedDepartments && !candidate.hasActiveApplicableDepartment) ||
        !candidate.permissions.has("catalog.manage")) continue;
    const medical = candidate.permissions.has("catalog.reference_ranges.manage");
    const finance = candidate.permissions.has("pricing.manage");
    if (medical) clinical.push(candidate.id);
    if (finance) financial.push(candidate.id);
    if ((medical || finance) && candidate.mfaEnabled) withMfa.add(candidate.id);
  }

  const medicalSet = new Set(clinical), financialSet = new Set(financial);
  const crossQualified = clinical.filter(id => financialSet.has(id)).length;
  const distinctPairAvailable = clinical.some(a => financial.some(b => a !== b));
  const gaps: SignatoryPlanningGap[] = [
    "FORMAL_SIGNATORY_ROLES_NOT_ESTABLISHED",
    "SIGNATURE_AUTHENTICATION_POLICY_UNDEFINED",
    "SIGNATURE_EVIDENCE_AND_VERSIONED_APPLICATION_NOT_IMPLEMENTED",
  ];
  if (!clinical.length) gaps.push("NO_INDEPENDENT_CLINICAL_REVIEW_CANDIDATE");
  if (!financial.length) gaps.push("NO_INDEPENDENT_FINANCIAL_REVIEW_CANDIDATE");
  if (!distinctPairAvailable) gaps.push("NO_TWO_DISTINCT_CROSS_DOMAIN_REVIEWERS");
  return {
    clinicalReviewerCandidates: medicalSet.size,
    financialReviewerCandidates: financialSet.size,
    crossQualifiedReviewers: crossQualified,
    distinctPairAvailable,
    mfaEnabledPotentialReviewers: withMfa.size,
    gaps,
    candidateCountsOnly: true, qualificationToSign: false,
    signaturePolicyApproved: false, signingEnabled: false,
    clinicalApprovalAllowed: false, financialApprovalAllowed: false,
    liveWrites: false,
  } as const;
}
