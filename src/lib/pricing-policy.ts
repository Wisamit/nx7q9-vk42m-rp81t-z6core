export type PricingScopeType = "ORGANIZATION" | "BRANCH" | "CLIENT" | "CONTRACT";

const scopeRank: Record<PricingScopeType, number> = {
  CONTRACT: 400,
  CLIENT: 300,
  BRANCH: 200,
  ORGANIZATION: 100,
};

export function comparePricingCandidates(
  a: { scopeType: PricingScopeType; priority: number; effectiveFrom: Date },
  b: { scopeType: PricingScopeType; priority: number; effectiveFrom: Date },
) {
  return (
    scopeRank[b.scopeType] - scopeRank[a.scopeType] ||
    b.priority - a.priority ||
    b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
  );
}
