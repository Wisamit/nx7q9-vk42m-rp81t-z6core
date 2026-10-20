import type { Prisma } from "../../generated/prisma/client";
import { BUNDLE_REVIEW_MAX_ROWS } from "./catalog-bundle-review.ts";
import { clinicalImportTestWhere, type ClinicalImportScope } from "./catalog-clinical-import-scope.ts";
import { catalogExportTypes, type CatalogExportType } from "./catalog-configuration-export.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Identity = { entityType: string; normalizedData: unknown; sourceData: unknown;
  status: string; importedEntityId: string | null };
type TypeIds = Map<CatalogExportType, string[]>;
type ScopedIdentities = { ok: true; ids: TypeIds; refs: {
  tests: Set<string>; units: Set<string>; components: Set<string>;
  lists: Set<string>; packages: Set<string>;
} };

export type PolicyReviewScopeCheck =
  | { ok: true }
  | { ok: false; error: "policy_review_batch_scope_changed" | "policy_review_source_integrity_error" };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/**
 * Source/normalized data are persisted in separate columns. A later policy
 * reviewer must not trust only the normalized membership or tariff identity:
 * tampered staging could otherwise conceal an off-scope source reference.
 * This is proof of staging parity, not approval of any source master values.
 */
function compositeStagingIdentityMatches(
  type: "PANEL" | "PACKAGE" | "PRICE_LIST_PACKAGE_ITEM",
  source: Record<string, unknown>, normalized: Record<string, unknown>,
): boolean {
  if (type === "PANEL" || type === "PACKAGE") {
    if (!Array.isArray(source.items) || !Array.isArray(normalized.items) ||
        !source.items.length || source.items.length !== normalized.items.length ||
        source.items.length > 1000) return false;
    return source.items.every((raw, index) => {
      const member = object(raw), projected = object(normalized.items[index]);
      const test = object(member?.test);
      return !!member && !!projected && !!test &&
        typeof member.testId === "string" && UUID.test(member.testId) &&
        member.testId === projected.testId &&
        typeof test.code === "string" && test.code.length > 0 &&
        test.code === projected.testCode &&
        Number.isSafeInteger(member.displayOrder) &&
        member.displayOrder === projected.displayOrder &&
        (type !== "PANEL" || (
          typeof member.required === "boolean" &&
          member.required === projected.required
        ));
    });
  }
  const pkg = object(source.package), list = object(source.priceList);
  return !!pkg && !!list &&
    typeof source.packageId === "string" && UUID.test(source.packageId) &&
    source.packageId === normalized.packageId &&
    typeof pkg.code === "string" && pkg.code.length > 0 &&
    pkg.code === normalized.packageCode &&
    typeof source.priceListId === "string" && UUID.test(source.priceListId) &&
    source.priceListId === normalized.priceListId &&
    typeof list.code === "string" && list.code.length > 0 &&
    list.code === normalized.priceListCode &&
    list.scopeType === normalized.scopeType &&
    (list.branchId ?? null) === (normalized.branchId ?? null) &&
    list.currency === normalized.currency &&
    source.unitPrice === normalized.unitPrice &&
    source.effectiveFrom === normalized.effectiveFrom &&
    (source.effectiveTo ?? null) === (normalized.effectiveTo ?? null) &&
    source.status === normalized.status;
}

/**
 * Check every staged identity, not the displayed queue page. Source JSON must
 * never be returned to a reviewer or written to an audit decision.
 */
export function policyReviewIdentityScope(
  rows: readonly Identity[], grantedBranches: ReadonlySet<string>,
): ScopedIdentities | { ok: false; error: "policy_review_batch_scope_changed" | "policy_review_source_integrity_error" } {
  if (!rows.length || rows.length > BUNDLE_REVIEW_MAX_ROWS ||
      rows.some(row => row.status !== "WARNING" || row.importedEntityId !== null))
    return { ok: false, error: "policy_review_batch_scope_changed" };
  const ids: TypeIds = new Map();
  const seen = new Set<string>();
  const refs = { tests: new Set<string>(), units: new Set<string>(),
    components: new Set<string>(), lists: new Set<string>(), packages: new Set<string>() };
  for (const row of rows) {
    const n = object(row.normalizedData), source = object(row.sourceData);
    const type = row.entityType as CatalogExportType;
    const id = n?.id;
    if (!catalogExportTypes.has(type) || !n || !source ||
        typeof id !== "string" || !UUID.test(id) || source.id !== id ||
        seen.has(type + ":" + id))
      return { ok: false, error: "policy_review_source_integrity_error" };
    if ((type === "PANEL" || type === "PACKAGE" ||
         type === "PRICE_LIST_PACKAGE_ITEM") &&
        !compositeStagingIdentityMatches(type, source, n))
      return { ok: false, error: "policy_review_source_integrity_error" };
    seen.add(type + ":" + id);
    ids.set(type, [...(ids.get(type) || []), id]);
    // Composite test membership is part of the clinical scope boundary:
    // every member must remain accessible, even if the parent still exists.
    if (type === "PANEL" || type === "PACKAGE") {
      if (!Array.isArray(n.items) || n.items.length < 1 || n.items.length > 1000)
        return { ok: false, error: "policy_review_source_integrity_error" };
      const members = new Set<string>();
      for (const raw of n.items) {
        const member = object(raw);
        const testId = member?.testId;
        if (typeof testId !== "string" || !UUID.test(testId) || members.has(testId))
          return { ok: false, error: "policy_review_source_integrity_error" };
        members.add(testId);
        refs.tests.add(testId);
      }
    }
    if (type === "PRICE_LIST_PACKAGE_ITEM") {
      if (typeof n.packageId !== "string" || !UUID.test(n.packageId))
        return { ok: false, error: "policy_review_source_integrity_error" };
      refs.packages.add(n.packageId);
    }
    // Generic catalog review must not gain knowledge of client/contract
    // tariffs through a staged parent price list or a nested relation.
    const privateFields = ["sourceId", "referrerId", "clientId", "contractId"];
    const tariff = type === "PRICE_LIST" ? source :
      type === "PRICE_LIST_ITEM" || type === "PRICE_LIST_PACKAGE_ITEM"
        ? object(source.priceList) : null;
    if (tariff && privateFields.some(field => tariff[field] != null))
      return { ok: false, error: "policy_review_source_integrity_error" };
    for (const [field, target] of [
      ["testId", refs.tests], ["unitId", refs.units],
      ["componentId", refs.components], ["priceListId", refs.lists],
    ] as const) {
      if (n[field] === undefined || n[field] === null) continue;
      if (typeof n[field] !== "string" || !UUID.test(n[field]))
        return { ok: false, error: "policy_review_source_integrity_error" };
      target.add(n[field]);
    }
    if (n.branchId !== null && n.branchId !== undefined &&
        (typeof n.branchId !== "string" || !grantedBranches.has(n.branchId)))
      return { ok: false, error: "policy_review_batch_scope_changed" };
    if ((n.scopeType === "BRANCH" && !n.branchId) ||
        (n.scopeType === "ORGANIZATION" && n.branchId))
      return { ok: false, error: "policy_review_source_integrity_error" };
    if ((type === "PRICE_LIST" || type === "PRICE_LIST_ITEM" ||
         type === "PRICE_LIST_PACKAGE_ITEM") &&
        n.scopeType !== "BRANCH" && n.scopeType !== "ORGANIZATION")
      return { ok: false, error: "policy_review_source_integrity_error" };
  }
  return { ok: true, ids, refs };
}

/**
 * Used inside the SAME tenant-locked transaction as the final reviewer audit
 * append. No assumptions about clinical/financial signing authority are made.
 */
export async function validatePolicyReviewBatchScope(
  tx: Prisma.TransactionClient, input: {
    batchId: string; scope: ClinicalImportScope; grantedBranchIds: readonly string[];
  },
): Promise<PolicyReviewScopeCheck> {
  const rows = await tx.catalogImportRow.findMany({
    where: { batchId: input.batchId }, orderBy: { rowNumber: "asc" },
    take: BUNDLE_REVIEW_MAX_ROWS + 1,
    select: { entityType: true, normalizedData: true, sourceData: true,
      status: true, importedEntityId: true },
  });
  const validated = policyReviewIdentityScope(rows, new Set(input.grantedBranchIds));
  if (!validated.ok) return validated;
  const { ids, refs } = validated;
  const org = input.scope.organizationId;
  const grantIds = [...input.grantedBranchIds];
  const testScope = { ...clinicalImportTestWhere(input.scope), status: undefined };
  const branchScope = { OR: [
    { branchId: null }, { branchId: { in: grantIds } },
  ] };
  const priceScope = {
    organizationId: org,
    sourceId: null, referrerId: null, clientId: null, contractId: null,
    OR: [
      { scopeType: "ORGANIZATION" as const, branchId: null },
      { scopeType: "BRANCH" as const, branchId: { in: grantIds } },
    ],
  };
  const fullyVisibleMembership = {
    some: {}, every: { test: testScope },
  };
  const allTestIds = [...new Set([...(ids.get("TEST") || []), ...refs.tests])];
  const allUnitIds = [...new Set([...(ids.get("UNIT") || []), ...refs.units])];
  const allComponentIds = [...new Set([...(ids.get("COMPONENT") || []), ...refs.components])];
  const allListIds = [...new Set([...(ids.get("PRICE_LIST") || []), ...refs.lists])];
  const allPackageIds = [...new Set([...(ids.get("PACKAGE") || []), ...refs.packages])];
  const counts = await Promise.all([
    tx.labTest.count({ where: { ...testScope,
      id: { in: allTestIds } } }),
    tx.unit.count({ where: { organizationId: org,
      id: { in: allUnitIds } } }),
    tx.testComponent.count({ where: { test: testScope,
      id: { in: allComponentIds } } }),
    tx.priceList.count({ where: { ...priceScope, id: { in: allListIds } } }),
    tx.referenceInterval.count({ where: { component: { test: testScope },
      ...branchScope, id: { in: ids.get("REFERENCE_INTERVAL") || [] } } }),
    tx.priceListItem.count({ where: { priceList: priceScope,
      test: testScope, id: { in: ids.get("PRICE_LIST_ITEM") || [] } } }),
    tx.container.count({ where: { organizationId: org,
      id: { in: ids.get("CONTAINER") || [] } } }),
    tx.testPanel.count({ where: { organizationId: org,
      items: fullyVisibleMembership,
      id: { in: ids.get("PANEL") || [] } } }),
    tx.commercialPackage.count({ where: { organizationId: org,
      items: fullyVisibleMembership, id: { in: allPackageIds } } }),
    tx.priceListPackageItem.count({ where: {
      priceList: priceScope,
      package: { organizationId: org, items: fullyVisibleMembership },
      id: { in: ids.get("PRICE_LIST_PACKAGE_ITEM") || [] },
    } }),
  ]);
  const sizes = [
    allTestIds.length,
    allUnitIds.length,
    allComponentIds.length,
    allListIds.length,
    (ids.get("REFERENCE_INTERVAL") || []).length,
    (ids.get("PRICE_LIST_ITEM") || []).length,
    (ids.get("CONTAINER") || []).length,
    (ids.get("PANEL") || []).length,
    allPackageIds.length,
    (ids.get("PRICE_LIST_PACKAGE_ITEM") || []).length,
  ];
  if (counts.some((count, index) => count !== sizes[index]))
    return { ok: false, error: "policy_review_batch_scope_changed" };
  return { ok: true };
}
