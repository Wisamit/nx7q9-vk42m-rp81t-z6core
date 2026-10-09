export type ValidationPolicyScope = "ORGANIZATION" | "DEPARTMENT" | "TEST";

export type ValidationPolicyLike = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  scope: ValidationPolicyScope;
  branchId: string | null;
  departmentId: string | null;
  testId: string | null;
  requiresMedicalValidation: boolean;
  allowSameReviewer: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type ValidationPolicySnapshot = {
  source: "CONFIGURED" | "DEFAULT" | "MIGRATED_BASELINE";
  policyId: string | null;
  code: string;
  nameEn: string;
  nameAr: string | null;
  scope: ValidationPolicyScope | null;
  branchId: string | null;
  departmentId: string | null;
  testId: string | null;
  requiresMedicalValidation: boolean;
  allowSameReviewer: boolean;
  effectiveFrom: string | null;
  effectiveTo: string | null;
};

const scopePriority: Record<ValidationPolicyScope, number> = {
  ORGANIZATION: 1,
  DEPARTMENT: 2,
  TEST: 3,
};

export function selectValidationPolicy(
  policies: ValidationPolicyLike[],
  context: { branchId: string; testId: string; departmentId: string | null },
) {
  return policies
    .filter(policy => {
      if (policy.branchId !== null && policy.branchId !== context.branchId) return false;
      if (policy.scope === "TEST") return policy.testId === context.testId;
      if (policy.scope === "DEPARTMENT") return Boolean(context.departmentId) && policy.departmentId === context.departmentId;
      return policy.scope === "ORGANIZATION";
    })
    .sort((a, b) =>
      scopePriority[b.scope] - scopePriority[a.scope]
      || Number(b.branchId !== null) - Number(a.branchId !== null)
      || b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
      || b.id.localeCompare(a.id)
    )[0] || null;
}

export function snapshotValidationPolicy(policy: ValidationPolicyLike | null): ValidationPolicySnapshot {
  if (!policy) {
    return {
      source: "DEFAULT",
      policyId: null,
      code: "DEFAULT_TECHNICAL_ONLY",
      nameEn: "Default technical review",
      nameAr: "المراجعة الفنية الافتراضية",
      scope: null,
      branchId: null,
      departmentId: null,
      testId: null,
      requiresMedicalValidation: false,
      allowSameReviewer: false,
      effectiveFrom: null,
      effectiveTo: null,
    };
  }

  return {
    source: "CONFIGURED",
    policyId: policy.id,
    code: policy.code,
    nameEn: policy.nameEn,
    nameAr: policy.nameAr,
    scope: policy.scope,
    branchId: policy.branchId,
    departmentId: policy.departmentId,
    testId: policy.testId,
    requiresMedicalValidation: policy.requiresMedicalValidation,
    allowSameReviewer: policy.allowSameReviewer,
    effectiveFrom: policy.effectiveFrom.toISOString(),
    effectiveTo: policy.effectiveTo?.toISOString() || null,
  };
}

export function stageAfterTechnicalReview(snapshot: ValidationPolicySnapshot) {
  return snapshot.requiresMedicalValidation ? "MEDICAL_VALIDATION" as const : "COMPLETE" as const;
}

export function automatedTechnicalReviewOutcome(
  snapshot: ValidationPolicySnapshot,
  input: { eligible: boolean; complete: boolean },
) {
  if (!input.complete) {
    return { resultStatus: "DRAFT" as const, validationStage: "ENTRY" as const, verificationComplete: false };
  }
  if (!input.eligible) {
    return { resultStatus: "ENTERED" as const, validationStage: "TECHNICAL_REVIEW" as const, verificationComplete: false };
  }
  if (snapshot.requiresMedicalValidation) {
    return { resultStatus: "ENTERED" as const, validationStage: "MEDICAL_VALIDATION" as const, verificationComplete: false };
  }
  return { resultStatus: "VERIFIED" as const, validationStage: "COMPLETE" as const, verificationComplete: true };
}

export function medicalReviewerAllowed(
  snapshot: ValidationPolicySnapshot,
  technicalReviewerUserId: string | null,
  candidateUserId: string,
) {
  return snapshot.allowSameReviewer || !technicalReviewerUserId || technicalReviewerUserId !== candidateUserId;
}

export function isResultEntryLockedByValidation(stage: string | null | undefined) {
  return stage === "MEDICAL_VALIDATION" || stage === "COMPLETE";
}

/**
 * Medical approval must be based on the exact previously approved technical
 * review for this result revision, not just a mutable stage/timestamp flag.
 * Historic baseline JSON is deliberately not upgraded into a medical policy.
 */
export function medicalApprovalEvidenceError(input: {
  policySnapshot: unknown;
  performingBranchId: string;
  testId: string;
  departmentId: string | null;
  technicalReviewedByUserId: string | null;
  technicalReviewedAt: Date | null;
  autoVerified: boolean;
  technicalReview: {
    stage: string;
    outcome: string;
    reviewerUserId: string | null;
    reviewedAt: Date;
    automated: boolean;
    policySnapshot: unknown;
  } | null;
  candidateUserId: string;
}): "medical_validation_policy_snapshot_invalid"
  | "technical_review_evidence_missing"
  | "medical_validator_must_differ_from_technical_reviewer"
  | null {
  const snapshot = input.policySnapshot;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return "medical_validation_policy_snapshot_invalid";
  }
  const policy = snapshot as Record<string, unknown>;
  const scope = policy.scope;
  if (policy.source !== "CONFIGURED"
    || typeof policy.policyId !== "string" || !policy.policyId
    || typeof policy.code !== "string" || !policy.code
    || policy.requiresMedicalValidation !== true
    || typeof policy.allowSameReviewer !== "boolean"
    || (policy.branchId !== null && policy.branchId !== input.performingBranchId)
    || !["ORGANIZATION", "DEPARTMENT", "TEST"].includes(String(scope))
    || (scope === "TEST" && policy.testId !== input.testId)
    || (scope === "DEPARTMENT" && (!input.departmentId || policy.departmentId !== input.departmentId))
    || (scope === "ORGANIZATION" && (policy.testId !== null || policy.departmentId !== null))) {
    return "medical_validation_policy_snapshot_invalid";
  }

  const review = input.technicalReview;
  if (!input.technicalReviewedAt || Number.isNaN(input.technicalReviewedAt.getTime())
    || !review || review.stage !== "TECHNICAL_REVIEW" || review.outcome !== "APPROVED"
    || !(review.reviewedAt instanceof Date)
    || review.reviewedAt.getTime() !== input.technicalReviewedAt.getTime()) {
    return "technical_review_evidence_missing";
  }
  const priorSnapshot = review.policySnapshot;
  if (!priorSnapshot || typeof priorSnapshot !== "object" || Array.isArray(priorSnapshot)
    || (priorSnapshot as Record<string, unknown>).policyId !== policy.policyId
    || (priorSnapshot as Record<string, unknown>).requiresMedicalValidation !== true) {
    return "technical_review_evidence_missing";
  }
  if (review.automated) {
    if (!input.autoVerified || review.reviewerUserId !== null || input.technicalReviewedByUserId !== null) {
      return "technical_review_evidence_missing";
    }
  } else if (!input.technicalReviewedByUserId || review.reviewerUserId !== input.technicalReviewedByUserId) {
    return "technical_review_evidence_missing";
  }

  if (!review.automated && policy.allowSameReviewer === false
    && input.technicalReviewedByUserId === input.candidateUserId) {
    return "medical_validator_must_differ_from_technical_reviewer";
  }
  return null;
}
