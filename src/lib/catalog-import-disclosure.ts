/**
 * Financial import candidates must never be disclosed by a catalog-only role,
 * nor through a price list owned by a branch outside the user's active scope.
 * This checks only identifiers; never include monetary values in diagnostics.
 */
export function stagedPriceListCode(normalized: unknown): string {
  if (!normalized || typeof normalized !== "object" || Array.isArray(normalized)) return "";
  const value = (normalized as Record<string, unknown>).priceListCode;
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

export type ScopedPriceList = { code: string; branchId: string | null };

export function authorizedStagedPrices(
  candidates: readonly unknown[],
  allowedLists: readonly ScopedPriceList[],
  activeBranchIds: ReadonlySet<string>,
): boolean {
  if (activeBranchIds.size === 0) return false;
  const byCode = new Map(allowedLists.map(list => [list.code.toUpperCase(), list.branchId]));
  return candidates.every(candidate => {
    const code = stagedPriceListCode(candidate);
    if (!code || !byCode.has(code)) return false;
    const branchId = byCode.get(code);
    return branchId === null || (typeof branchId === "string" && activeBranchIds.has(branchId));
  });
}
