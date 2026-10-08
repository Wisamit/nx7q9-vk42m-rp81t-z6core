export type TatPolicyGovernanceLike = {
  id: string;
  testId: string;
  branchId: string | null;
  priority: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export function sameTatPolicyScope(
  left: TatPolicyGovernanceLike,
  right: TatPolicyGovernanceLike,
) {
  return left.testId === right.testId
    && left.branchId === right.branchId
    && left.priority === right.priority;
}

export function tatPolicyWindowsOverlap(
  left: Pick<TatPolicyGovernanceLike, "effectiveFrom" | "effectiveTo">,
  right: Pick<TatPolicyGovernanceLike, "effectiveFrom" | "effectiveTo">,
) {
  return (left.effectiveTo === null || right.effectiveFrom <= left.effectiveTo)
    && (right.effectiveTo === null || left.effectiveFrom <= right.effectiveTo);
}

export function planTatPolicyApproval(
  draft: TatPolicyGovernanceLike,
  approved: TatPolicyGovernanceLike[],
) {
  const predecessorsToClose: string[] = [];
  const conflicts: string[] = [];

  for (const current of approved) {
    if (!sameTatPolicyScope(draft, current)) continue;
    if (!tatPolicyWindowsOverlap(draft, current)) continue;

    if (current.effectiveFrom < draft.effectiveFrom) {
      predecessorsToClose.push(current.id);
    } else {
      conflicts.push(current.id);
    }
  }

  return { predecessorsToClose, conflicts };
}

export function tatPolicyClinicallyUsable(input: {
  status: "ACTIVE" | "INACTIVE";
  approvalStatus: "DRAFT" | "APPROVED" | "RETIRED";
  approvedAt: Date | null;
}) {
  return input.status === "ACTIVE"
    && input.approvalStatus === "APPROVED"
    && input.approvedAt !== null;
}
