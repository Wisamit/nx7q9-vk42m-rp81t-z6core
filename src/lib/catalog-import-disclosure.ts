/**
 * Financial import candidates must never be disclosed by a catalog-only role,
 * nor through a scoped customer, contract or other specialized price list.
 * Only organization-wide or explicitly authorized branch price lists can be
 * reviewed by this generic CSV staging workflow. This checks identifiers only.
 */
export function stagedPriceListCode(normalized: unknown): string {
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return "";
  const value = (normalized as Record<string, unknown>).priceListCode;
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export type ScopedPriceList = {
  code: string;
  branchId: string | null;
  scopeType: string;
};

export function isGenericPriceReviewScope(
  list: Pick<ScopedPriceList, "scopeType" | "branchId">,
  activeBranchIds: ReadonlySet<string>,
): boolean {
  if (activeBranchIds.size === 0) return false;
  if (list.scopeType === "ORGANIZATION") return list.branchId === null;
  if (list.scopeType === "BRANCH") {
    return typeof list.branchId === "string" && activeBranchIds.has(list.branchId);
  }
  // CLIENT / CONTRACT / SOURCE / REFERRER pricing needs separate governed review.
  return false;
}

export function authorizedStagedPrices(
  candidates: readonly unknown[],
  allowedLists: readonly ScopedPriceList[],
  activeBranchIds: ReadonlySet<string>,
): boolean {
  if (activeBranchIds.size === 0) return false;
  const byCode = new Map<string, ScopedPriceList | null>();
  for (const list of allowedLists) {
    const key = list.code.trim().toUpperCase();
    if (!key) continue;
    // Duplicate identities must never be resolved by arbitrary input order.
    byCode.set(key, byCode.has(key) ? null : list);
  }
  return candidates.every(candidate => {
    const code = stagedPriceListCode(candidate);
    const list = byCode.get(code);
    return Boolean(code && list && isGenericPriceReviewScope(list, activeBranchIds));
  });
}
