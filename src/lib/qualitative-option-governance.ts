export type QualitativeOptionGovernanceLike = {
  id: string;
  testId: string;
  componentId: string | null;
  code: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export function qualitativeOptionWindowsOverlap(
  left: Pick<QualitativeOptionGovernanceLike, "effectiveFrom" | "effectiveTo">,
  right: Pick<QualitativeOptionGovernanceLike, "effectiveFrom" | "effectiveTo">,
) {
  return (left.effectiveTo === null || right.effectiveFrom <= left.effectiveTo)
    && (right.effectiveTo === null || left.effectiveFrom <= right.effectiveTo);
}

export function sameQualitativeOptionIdentity(
  left: Pick<QualitativeOptionGovernanceLike, "testId" | "componentId" | "code">,
  right: Pick<QualitativeOptionGovernanceLike, "testId" | "componentId" | "code">,
) {
  return left.testId === right.testId
    && left.componentId === right.componentId
    && left.code === right.code;
}

export function planQualitativeOptionApproval(
  draft: QualitativeOptionGovernanceLike,
  approved: QualitativeOptionGovernanceLike[],
) {
  const predecessorsToClose: string[] = [];
  const conflicts: string[] = [];

  for (const current of approved) {
    if (!sameQualitativeOptionIdentity(draft, current)) continue;
    if (!qualitativeOptionWindowsOverlap(draft, current)) continue;

    if (current.effectiveFrom < draft.effectiveFrom) {
      predecessorsToClose.push(current.id);
    } else {
      conflicts.push(current.id);
    }
  }

  return { predecessorsToClose, conflicts };
}

export function qualitativeOptionClinicallyUsable(input: {
  status: "ACTIVE" | "INACTIVE";
  approvalStatus: "DRAFT" | "APPROVED" | "RETIRED";
  approvedAt: Date | null;
}) {
  return input.status === "ACTIVE"
    && input.approvalStatus === "APPROVED"
    && input.approvedAt !== null;
}
