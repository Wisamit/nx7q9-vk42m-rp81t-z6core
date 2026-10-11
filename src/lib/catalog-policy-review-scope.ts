import type { Prisma } from "../../generated/prisma/client";
import { BUNDLE_REVIEW_MAX_ROWS } from "./catalog-bundle-review.ts";
import { clinicalImportTestWhere, type ClinicalImportScope } from "./catalog-clinical-import-scope.ts";
import { catalogExportTypes, type CatalogExportType } from "./catalog-configuration-export.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Identity = { entityType: string; normalizedData: unknown; sourceData: unknown;
  status: string; importedEntityId: string | null };
type TypeIds = Map<CatalogExportType, string[]>;
type ScopedIdentities = { ok: true; ids: TypeIds; refs: {
  tests: Set<string>; units: Set<string>; components: Set<string>; lists: Set<string>;
} };

export type PolicyReviewScopeCheck =
  | { ok: true }
  | { ok: false; error: "policy_review_batch_scope_changed" | "policy_review_source_integrity_error" };

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
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
    components: new Set<string>(), lists: new Set<string>() };
  for (const row of rows) {
    const n = object(row.normalizedData), source = object(row.sourceData);
    const type = row.entityType as CatalogExportType;
    const id = n?.id;
    if (!catalogExportTypes.has(type) || !n || !source ||
        typeof id !== "string" || !UUID.test(id) || source.id !== id ||
        seen.has(type + ":" + id))
      return { ok: false, error: "policy_review_source_integrity_error" };
    seen.add(type + ":" + id);
    ids.set(type, [...(ids.get(type) || []), id]);
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
    if ((type === "PRICE_LIST" || type === "PRICE_LIST_ITEM") &&
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
  const priceScope = { OR: [
    { scopeType: "ORGANIZATION" as const, branchId: null },
    { scopeType: "BRANCH" as const, branchId: { in: grantIds } },
  ] };
  const counts = await Promise.all([
    tx.labTest.count({ where: { ...testScope,
      id: { in: [...new Set([...(ids.get("TEST") || []), ...refs.tests])] } } }),
    tx.unit.count({ where: { organizationId: org,
      id: { in: [...new Set([...(ids.get("UNIT") || []), ...refs.units])] } } }),
    tx.testComponent.count({ where: { test: testScope,
      id: { in: [...new Set([...(ids.get("COMPONENT") || []), ...refs.components])] } } }),
    tx.priceList.count({ where: { organizationId: org, ...priceScope,
      id: { in: [...new Set([...(ids.get("PRICE_LIST") || []), ...refs.lists])] } } }),
    tx.referenceInterval.count({ where: { component: { test: testScope },
      ...branchScope, id: { in: ids.get("REFERENCE_INTERVAL") || [] } } }),
    tx.priceListItem.count({ where: { priceList: { organizationId: org, ...priceScope },
      test: testScope, id: { in: ids.get("PRICE_LIST_ITEM") || [] } } }),
  ]);
  const sizes = [
    new Set([...(ids.get("TEST") || []), ...refs.tests]).size,
    new Set([...(ids.get("UNIT") || []), ...refs.units]).size,
    new Set([...(ids.get("COMPONENT") || []), ...refs.components]).size,
    new Set([...(ids.get("PRICE_LIST") || []), ...refs.lists]).size,
    (ids.get("REFERENCE_INTERVAL") || []).length,
    (ids.get("PRICE_LIST_ITEM") || []).length,
  ];
  if (counts.some((count, index) => count !== sizes[index]))
    return { ok: false, error: "policy_review_batch_scope_changed" };
  return { ok: true };
}
