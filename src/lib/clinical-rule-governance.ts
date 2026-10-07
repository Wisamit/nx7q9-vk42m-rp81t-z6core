export type ClinicalRuleLifecycleState = "DRAFT" | "APPROVED" | "RETIRED";

export type GovernedClinicalRule = {
  id: string;
  identityKey: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  status: "ACTIVE" | "INACTIVE";
  deactivatedAt: Date | null;
  authorizationBranchId?: string | null;
};

export function clinicalRuleLifecycleState(input: Pick<GovernedClinicalRule, "status" | "deactivatedAt">): ClinicalRuleLifecycleState {
  if (input.status === "ACTIVE") return "APPROVED";
  return input.deactivatedAt ? "RETIRED" : "DRAFT";
}

export function clinicalRuleWindowsOverlap(
  left: Pick<GovernedClinicalRule, "effectiveFrom" | "effectiveTo">,
  right: Pick<GovernedClinicalRule, "effectiveFrom" | "effectiveTo">,
) {
  return (left.effectiveTo === null || right.effectiveFrom <= left.effectiveTo)
    && (right.effectiveTo === null || left.effectiveFrom <= right.effectiveTo);
}

export function planClinicalRuleApproval(
  draft: GovernedClinicalRule,
  activeRules: GovernedClinicalRule[],
) {
  const predecessorsToClose: string[] = [];
  const conflicts: string[] = [];

  for (const current of activeRules) {
    if (current.id === draft.id || current.identityKey !== draft.identityKey) continue;
    if (!clinicalRuleWindowsOverlap(draft, current)) continue;

    if (current.effectiveFrom < draft.effectiveFrom) {
      predecessorsToClose.push(current.id);
    } else {
      conflicts.push(current.id);
    }
  }

  return { predecessorsToClose, conflicts };
}

export function ruleIdentity(parts: Array<string | number | boolean | null | undefined>) {
  return JSON.stringify(parts.map(value => value ?? null));
}
