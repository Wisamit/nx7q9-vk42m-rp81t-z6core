/**
 * Generic catalog exports must never expose tariff identities or amounts
 * belonging to referrers, sources, clients or contracts, even when a legacy
 * or imported price list has ORGANIZATION/BRANCH scopeType.
 *
 * Reuse this predicate on the price-list master AND on every nested
 * price-list relation (test and package tariff items). Branch IDs must
 * come from currently authorized, active branch grants.
 */
export function genericCatalogPriceScope(branchIds: readonly string[]) {
  return {
    sourceId: null,
    referrerId: null,
    clientId: null,
    contractId: null,
    OR: [
      { scopeType: "ORGANIZATION" as const, branchId: null },
      { scopeType: "BRANCH" as const, branchId: { in: [...branchIds] } },
    ],
  };
}
