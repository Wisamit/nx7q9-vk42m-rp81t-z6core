export type ValidationPolicyScope = "ORGANIZATION" | "DEPARTMENT" | "TEST";

export type ValidationPolicyLike = {
  id: string;
  code: string;
  nameEn: string;
  nameAr: string | null;
  scope: ValidationPolicyScope;
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
  context: { testId: string; departmentId: string | null },
) {
  return policies
    .filter(policy => {
      if (policy.scope === "TEST") return policy.testId === context.testId;
      if (policy.scope === "DEPARTMENT") return Boolean(context.departmentId) && policy.departmentId === context.departmentId;
      return policy.scope === "ORGANIZATION";
    })
    .sort((a, b) =>
      scopePriority[b.scope] - scopePriority[a.scope]
      || b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
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
