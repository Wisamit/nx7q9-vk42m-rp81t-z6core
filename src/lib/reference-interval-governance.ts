type DecimalLike = { toString(): string } | number | string | null;

export type ReferenceIntervalContextLike = {
  id: string;
  branchId: string | null;
  methodId: string | null;
  analyzerId: string | null;
  specimenTypeId: string | null;
  sex: string;
  ageFrom: DecimalLike;
  ageTo: DecimalLike;
  ageUnit: string | null;
  pregnancyStatus: string | null;
  gestationalAgeFromWeeks: DecimalLike;
  gestationalAgeToWeeks: DecimalLike;
  populationCode: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

function scalar(value: DecimalLike) {
  if (value === null) return null;
  return value.toString();
}

export function sameReferenceIntervalContext(
  left: ReferenceIntervalContextLike,
  right: ReferenceIntervalContextLike,
) {
  return left.branchId === right.branchId
    && left.methodId === right.methodId
    && left.analyzerId === right.analyzerId
    && left.specimenTypeId === right.specimenTypeId
    && left.sex === right.sex
    && scalar(left.ageFrom) === scalar(right.ageFrom)
    && scalar(left.ageTo) === scalar(right.ageTo)
    && left.ageUnit === right.ageUnit
    && left.pregnancyStatus === right.pregnancyStatus
    && scalar(left.gestationalAgeFromWeeks) === scalar(right.gestationalAgeFromWeeks)
    && scalar(left.gestationalAgeToWeeks) === scalar(right.gestationalAgeToWeeks)
    && (left.populationCode || null) === (right.populationCode || null);
}

export function referenceIntervalWindowsOverlap(
  left: Pick<ReferenceIntervalContextLike, "effectiveFrom" | "effectiveTo">,
  right: Pick<ReferenceIntervalContextLike, "effectiveFrom" | "effectiveTo">,
) {
  return (left.effectiveTo === null || right.effectiveFrom <= left.effectiveTo)
    && (right.effectiveTo === null || left.effectiveFrom <= right.effectiveTo);
}

export function planReferenceIntervalApproval(
  draft: ReferenceIntervalContextLike,
  approved: ReferenceIntervalContextLike[],
) {
  const predecessorsToClose: string[] = [];
  const conflicts: string[] = [];

  for (const current of approved) {
    if (!sameReferenceIntervalContext(draft, current)) continue;
    if (!referenceIntervalWindowsOverlap(draft, current)) continue;

    if (current.effectiveFrom < draft.effectiveFrom) {
      predecessorsToClose.push(current.id);
    } else {
      conflicts.push(current.id);
    }
  }

  return { predecessorsToClose, conflicts };
}

export function referenceIntervalClinicallyUsable(input: {
  status: "ACTIVE" | "INACTIVE";
  approvalStatus: "DRAFT" | "APPROVED" | "RETIRED";
  approvedAt: Date | null;
}) {
  return input.status === "ACTIVE"
    && input.approvalStatus === "APPROVED"
    && input.approvedAt !== null;
}
