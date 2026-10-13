/**
 * Validate exported composite master identity without converting it to a live write.
 * The source UUIDs are local evidence pointers, not portable foreign tenant IDs.
 */
export type CompositeBundleType = "PANEL" | "PACKAGE" | "PRICE_LIST_PACKAGE_ITEM";
export type CompositeMember = { testId: string; testCode: string; displayOrder: number; required?: boolean };
export type CompositeBundleNormalized = {
  id: string;
  code?: string;
  nameEn?: string;
  status: "ACTIVE" | "INACTIVE";
  items?: CompositeMember[];
  packageId?: string;
  packageCode?: string;
  priceListId?: string;
  priceListCode?: string;
  currency?: string;
  scopeType?: "ORGANIZATION" | "BRANCH";
  branchId?: string | null;
  unitPrice?: string;
  effectiveFrom?: string;
  effectiveTo?: string | null;
};

export class CompositeBundleError extends Error {
  constructor(readonly code: string) { super(code); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new CompositeBundleError("bundle_composite_invalid_structure");
  return value as Record<string, unknown>;
};
const id = (value: unknown) => {
  if (typeof value !== "string" || !UUID.test(value))
    throw new CompositeBundleError("bundle_composite_invalid_reference");
  return value.toLowerCase();
};
const bounded = (value: unknown, max: number) => {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new CompositeBundleError("bundle_composite_invalid_identity");
  return value;
};
const status = (value: unknown): "ACTIVE" | "INACTIVE" => {
  if (value !== "ACTIVE" && value !== "INACTIVE")
    throw new CompositeBundleError("bundle_composite_invalid_status");
  return value;
};
const date = (value: unknown): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
    !Number.isFinite(Date.parse(value))) throw new CompositeBundleError("bundle_composite_invalid_date");
  return value;
};

export function parseCompositeBundleRow(
  entityType: CompositeBundleType, source: Record<string, unknown>,
): CompositeBundleNormalized {
  const identity = id(source.id), rowStatus = status(source.status);
  if (entityType === "PANEL" || entityType === "PACKAGE") {
    const code = bounded(source.code, 80), nameEn = bounded(source.nameEn, entityType === "PANEL" ? 200 : 220);
    if (!Array.isArray(source.items) || source.items.length < 1 || source.items.length > 1000)
      throw new CompositeBundleError("bundle_composite_incomplete_membership");
    const seen = new Set<string>();
    const items: CompositeMember[] = source.items.map(raw => {
      const member = asObject(raw);
      const testId = id(member.testId), testCode = bounded(asObject(member.test).code, 80);
      if (seen.has(testId)) throw new CompositeBundleError("bundle_composite_duplicate_member");
      seen.add(testId);
      if (!Number.isSafeInteger(member.displayOrder) ||
        (entityType === "PANEL" && typeof member.required !== "boolean"))
        throw new CompositeBundleError("bundle_composite_invalid_member");
      return {
        testId, testCode, displayOrder: member.displayOrder as number,
        ...(entityType === "PANEL" ? { required: member.required as boolean } : {}),
      };
    });
    return { id: identity, code, nameEn, status: rowStatus, items };
  }
  const priceList = asObject(source.priceList);
  const linkedPackage = asObject(source.package);
  const scopeType = priceList.scopeType;
  if (scopeType !== "ORGANIZATION" && scopeType !== "BRANCH")
    throw new CompositeBundleError("bundle_composite_private_price_scope");
  const branchId = priceList.branchId == null ? null : id(priceList.branchId);
  if ((scopeType === "ORGANIZATION" && branchId !== null) ||
      (scopeType === "BRANCH" && branchId === null))
    throw new CompositeBundleError("bundle_composite_price_branch_mismatch");
  if (typeof priceList.currency !== "string" || !/^[A-Z]{3}$/.test(priceList.currency))
    throw new CompositeBundleError("bundle_composite_invalid_currency");
  if (typeof source.unitPrice !== "string" ||
    !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(source.unitPrice))
    throw new CompositeBundleError("bundle_composite_invalid_decimal_price");
  const from = date(source.effectiveFrom);
  const to = source.effectiveTo == null ? null : date(source.effectiveTo);
  if (to !== null && new Date(to).getTime() < new Date(from).getTime())
    throw new CompositeBundleError("bundle_composite_invalid_effective_window");
  return {
    id: identity, status: rowStatus,
    packageId: id(source.packageId), packageCode: bounded(linkedPackage.code, 80),
    priceListId: id(source.priceListId), priceListCode: bounded(priceList.code, 80),
    scopeType, branchId, currency: priceList.currency,
    unitPrice: source.unitPrice, effectiveFrom: from, effectiveTo: to,
  };
}

/** Equality covers the complete ordered membership, never a convenient visible subset. */
export function sameCompositeMembership(
  staged: readonly CompositeMember[], live: readonly CompositeMember[], type: "PANEL" | "PACKAGE",
): boolean {
  if (!staged.length || staged.length !== live.length) return false;
  const byTest = new Map(live.map(member => [member.testId, member]));
  if (byTest.size !== live.length) return false;
  return staged.every(member => {
    const found = byTest.get(member.testId);
    return !!found && found.testCode === member.testCode &&
      found.displayOrder === member.displayOrder &&
      (type !== "PANEL" || found.required === member.required);
  });
}
