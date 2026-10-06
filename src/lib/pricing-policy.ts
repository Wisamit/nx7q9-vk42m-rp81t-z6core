export type PricingScopeType = "ORGANIZATION" | "BRANCH" | "SOURCE" | "CLIENT" | "CONTRACT";

const scopeRank: Record<PricingScopeType, number> = {
  CONTRACT: 500,
  CLIENT: 400,
  SOURCE: 300,
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
