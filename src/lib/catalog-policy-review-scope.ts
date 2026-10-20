import type { Prisma } from "../../generated/prisma/client";
import { BUNDLE_REVIEW_MAX_ROWS } from "./catalog-bundle-review.ts";
import { verifyReviewStageEvidence, type ReviewStageEvidenceBatchMetadata } from "./catalog-review-stage-evidence.ts";
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
 * The three ordinary catalog master types also have separate source and
 * normalized identities in DRAFT staging. Do not let a later DB mutation
 * swap the reviewed test, unit, or container metadata while retaining its UUID.
 * This is evidence parity only; no configuration activation occurs here.
 */
function scalarStagingIdentityMatches(
  type: "TEST" | "UNIT" | "CONTAINER",
  source: Record<string, unknown>,
  normalized: Record<string, unknown>,
): boolean {
  if (typeof source.code !== "string" || !source.code ||
      source.code !== normalized.code ||
      source.status !== normalized.status) return false;
  if (type === "TEST") {
    return typeof source.nameEn === "string" && !!source.nameEn &&
      source.nameEn === normalized.nameEn &&
      (source.departmentId === null ||
        (typeof source.departmentId === "string" && UUID.test(source.departmentId))) &&
      source.departmentId === normalized.departmentId;
  }
  if (type === "UNIT") {
    return typeof source.symbol === "string" && !!source.symbol &&
      source.symbol === normalized.symbol;
  }
  if (typeof source.nameEn !== "string" || !source.nameEn ||
      source.nameEn !== normalized.nameEn) return false;
  return (["nameAr", "tubeColor", "additive"] as const).every(field =>
    (source[field] === null || typeof source[field] === "string") &&
    source[field] === normalized[field]);
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
      const member = object(raw), projected = object((normalized.items as unknown[])[index]);
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
 * The ordinary test-price item and its parent tariff are a distinct financial
 * source class from a package-price item. Both snapshots live in DRAFT rows;
 * no reviewer may attest to a silently changed price, test identity, list
 * scope or currency. This validates persisted review evidence only.
 */
function financialStagingIdentityMatches(
  type: "PRICE_LIST" | "PRICE_LIST_ITEM",
  source: Record<string, unknown>,
  normalized: Record<string, unknown>,
): boolean {
  if (type === "PRICE_LIST") {
    return typeof source.code === "string" && source.code.length > 0 &&
      source.code === normalized.code &&
      typeof source.currency === "string" && source.currency.length === 3 &&
      source.currency === normalized.currency &&
      source.scopeType === normalized.scopeType &&
      (source.branchId ?? null) === (normalized.branchId ?? null) &&
      source.status === normalized.status;
  }
  const test = object(source.test), list = object(source.priceList);
  return !!test && !!list &&
    typeof source.testId === "string" && UUID.test(source.testId) &&
    source.testId === normalized.testId &&
    typeof test.code === "string" && test.code.length > 0 &&
    test.code === normalized.testCode &&
    typeof source.priceListId === "string" && UUID.test(source.priceListId) &&
    source.priceListId === normalized.priceListId &&
    typeof list.code === "string" && list.code.length > 0 &&
    list.code === normalized.priceListCode &&
    typeof list.currency === "string" && list.currency.length === 3 &&
    (list.scopeType === "ORGANIZATION" || list.scopeType === "BRANCH") &&
    list.scopeType === normalized.scopeType &&
    (list.branchId ?? null) === (normalized.branchId ?? null) &&
    typeof source.unitPrice === "string" &&
    /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(source.unitPrice) &&
    source.unitPrice === normalized.unitPrice &&
    typeof source.effectiveFrom === "string" &&
    Number.isFinite(Date.parse(source.effectiveFrom)) &&
    source.effectiveFrom === normalized.effectiveFrom &&
    source.status === normalized.status;
}

/**
 * Reviewer evidence must retain the original clinical relationship to the
 * analyte and its linked test, even if the reference interval has changed in
 * the live laboratory. This is DRAFT source/staging parity, not clinical
 * approval or an assertion that imported values should replace live ranges.
 */
function clinicalStagingIdentityMatches(
  type: "COMPONENT" | "REFERENCE_INTERVAL",
  source: Record<string, unknown>,
  normalized: Record<string, unknown>,
): boolean {
  if (type === "COMPONENT") {
    const test = object(source.test);
    return !!test &&
      typeof source.testId === "string" && UUID.test(source.testId) &&
      source.testId === normalized.testId &&
      typeof test.code === "string" && test.code.length > 0 &&
      test.code === normalized.testCode &&
      typeof source.code === "string" && source.code.length > 0 &&
      source.code === normalized.code &&
      typeof source.nameEn === "string" && source.nameEn.length > 0 &&
      source.nameEn === normalized.nameEn &&
      (source.unitId === null || (typeof source.unitId === "string" && UUID.test(source.unitId))) &&
      source.unitId === normalized.unitId &&
      source.status === normalized.status;
  }
  const component = object(source.component);
  const test = object(component?.test);
  return !!component && !!test &&
    typeof source.componentId === "string" && UUID.test(source.componentId) &&
    source.componentId === normalized.componentId &&
    typeof component.code === "string" && component.code.length > 0 &&
    component.code === normalized.componentCode &&
    typeof test.code === "string" && test.code.length > 0 &&
    test.code === normalized.testCode &&
    (source.branchId === null || (typeof source.branchId === "string" && UUID.test(source.branchId))) &&
    source.branchId === normalized.branchId &&
    typeof source.effectiveFrom === "string" &&
    Number.isFinite(Date.parse(source.effectiveFrom)) &&
    new Date(source.effectiveFrom).toISOString() === normalized.effectiveFrom &&
    source.approvalStatus === normalized.approvalStatus &&
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
    if ((type === "TEST" || type === "UNIT" || type === "CONTAINER") &&
        !scalarStagingIdentityMatches(type, source, n))
      return { ok: false, error: "policy_review_source_integrity_error" };
    if ((type === "PANEL" || type === "PACKAGE" ||
         type === "PRICE_LIST_PACKAGE_ITEM") &&
        !compositeStagingIdentityMatches(type, source, n))
      return { ok: false, error: "policy_review_source_integrity_error" };
    if ((type === "PRICE_LIST" || type === "PRICE_LIST_ITEM") &&
        !financialStagingIdentityMatches(type, source, n))
      return { ok: false, error: "policy_review_source_integrity_error" };
    if ((type === "COMPONENT" || type === "REFERENCE_INTERVAL") &&
        !clinicalStagingIdentityMatches(type, source, n))
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
 * A source/normalized staging match is not enough if a live composite has
 * since gained, lost or reordered a clinically performed test. Compare the
 * *entire* current membership by immutable test ID, display order and the
 * panel's required flag, not only a subset of permitted tests. This only
 * gates review: it never applies or authorizes source configuration.
 */
function sameLiveMembership(
  type: "PANEL" | "PACKAGE",
  staged: unknown,
  live: readonly { testId: string; displayOrder: number; required?: boolean }[],
): boolean {
  if (!Array.isArray(staged) || staged.length !== live.length || !staged.length)
    return false;
  const expected = new Map<string, { displayOrder: number; required?: boolean }>();
  for (const raw of staged) {
    const member = object(raw);
    if (!member || typeof member.testId !== "string" || !UUID.test(member.testId) ||
        !Number.isSafeInteger(member.displayOrder) || expected.has(member.testId) ||
        (type === "PANEL" && typeof member.required !== "boolean")) return false;
    expected.set(member.testId, {
      displayOrder: member.displayOrder as number,
      ...(type === "PANEL" ? { required: member.required as boolean } : {}),
    });
  }
  if (expected.size !== live.length) return false;
  const observed = new Set<string>();
  for (const member of live) {
    const match = expected.get(member.testId);
    if (!match || observed.has(member.testId) ||
        match.displayOrder !== member.displayOrder ||
        (type === "PANEL" && match.required !== member.required)) return false;
    observed.add(member.testId);
  }
  return true;
}

/**
 * Live catalog identity can drift after DRAFT staging while the same immutable
 * UUID still passes tenant and branch counts. A reviewer must not mistake a
 * changed test/unit/container for the version captured in the source snapshot.
 * This checks the review identity subset, not full configuration parity/apply.
 */
export function sameLiveScalarIdentity(
  type: "TEST" | "UNIT" | "CONTAINER",
  staged: unknown, live: unknown,
): boolean {
  const n = object(staged), current = object(live);
  if (!n || !current) return false;
  const fields = type === "TEST"
    ? ["code", "nameEn", "departmentId", "status"]
    : type === "UNIT"
      ? ["code", "symbol", "status"]
      : ["code", "nameEn", "nameAr", "tubeColor", "additive", "status"];
  return fields.every(field =>
    Object.hasOwn(n, field) && current[field] === n[field]);
}

/**
 * Read-only monetary reviewer parity. Never use JS numbers for amounts:
 * DECIMAL(18,4) comparisons are performed on integer scaled text.
 */
function scaledTariff(value: unknown): bigint | null {
  if (typeof value !== "string") {
    if (!value || typeof value !== "object" ||
        !("toString" in value) || typeof value.toString !== "function") return null;
    value = value.toString();
  }
  if (typeof value !== "string" ||
      !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(value)) return null;
  const [whole, fractional = ""] = value.split(".");
  return BigInt(whole + fractional.padEnd(4, "0"));
}

function sameTime(value: unknown, live: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    live instanceof Date && Number.isFinite(live.getTime()) &&
    new Date(value).getTime() === live.getTime();
}
function sameOptionalTime(value: unknown, live: unknown): boolean {
  return value === null ? live === null : sameTime(value, live);
}

/**
 * Evidence-only check against live financial identities, not tariff approval.
 * Parent scope is enforced by the Prisma where clause separately.
 */
export function sameLiveTariffReviewIdentity(
  type: "PRICE_LIST" | "PRICE_LIST_ITEM" | "PRICE_LIST_PACKAGE_ITEM",
  staged: unknown, source: unknown, live: unknown,
): boolean {
  const n = object(staged), s = object(source), current = object(live);
  if (!n || !s || !current || n.id !== current.id) return false;
  if (type === "PRICE_LIST") {
    if (!["code", "currency", "scopeType", "branchId", "status"].every(field =>
      Object.hasOwn(n, field) && n[field] === current[field])) return false;
    // Legacy DRAFT rows may have omitted effective windows; never claim
    // complete window parity when those fields are missing.
    return (!Object.hasOwn(s, "effectiveFrom") ||
        sameTime(s.effectiveFrom, current.effectiveFrom)) &&
      (!Object.hasOwn(s, "effectiveTo") ||
        sameOptionalTime(s.effectiveTo, current.effectiveTo));
  }

  const parent = object(current.priceList);
  const originalParent = object(s.priceList);
  const linked = type === "PRICE_LIST_ITEM"
    ? object(current.test) : object(current.package);
  if (!parent || !originalParent || !linked ||
      current.priceListId !== n.priceListId ||
      (type === "PRICE_LIST_ITEM" ? current.testId !== n.testId
        : current.packageId !== n.packageId) ||
      linked.code !== (type === "PRICE_LIST_ITEM" ? n.testCode : n.packageCode) ||
      parent.code !== n.priceListCode ||
      parent.scopeType !== n.scopeType || parent.branchId !== n.branchId ||
      parent.currency !== originalParent.currency ||
      (type === "PRICE_LIST_PACKAGE_ITEM" && parent.currency !== n.currency) ||
      (Object.hasOwn(originalParent, "status") &&
        parent.status !== originalParent.status) ||
      current.status !== n.status ||
      !sameTime(n.effectiveFrom, current.effectiveFrom) ||
      (Object.hasOwn(s, "effectiveTo") &&
        !sameOptionalTime(s.effectiveTo, current.effectiveTo))) return false;
  const expected = scaledTariff(n.unitPrice);
  const actual = scaledTariff(current.unitPrice);
  return expected !== null && actual !== null && expected === actual;
}

/**
 * Prevent stale clinical reviewer evidence when live component/interval
 * identities change after staging. These are only the projection fields
 * recorded by CONFIG_BUNDLE_REVIEW v1, never clinical range approval.
 */
export function sameLiveClinicalReviewIdentity(
  type: "COMPONENT" | "REFERENCE_INTERVAL",
  staged: unknown, live: unknown,
): boolean {
  const n = object(staged), current = object(live);
  if (!n || !current || typeof n.id !== "string" ||
      n.id !== current.id) return false;
  if (type === "COMPONENT") {
    const test = object(current.test);
    return !!test &&
      ["testId", "unitId", "code", "nameEn", "status"].every(field =>
        Object.hasOwn(n, field) && n[field] === current[field]) &&
      typeof n.testCode === "string" && n.testCode === test.code;
  }
  const component = object(current.component);
  const test = object(component?.test);
  return !!component && !!test &&
    ["componentId", "branchId", "approvalStatus", "status"].every(field =>
      Object.hasOwn(n, field) && n[field] === current[field]) &&
    typeof n.componentCode === "string" && n.componentCode === component.code &&
    typeof n.testCode === "string" && n.testCode === test.code &&
    sameTime(n.effectiveFrom, current.effectiveFrom);
}

/**
 * Only the full, explicitly exported reference-interval medical snapshot
 * can support a current-review statement. Omission is not evidence that an
 * omitted field is unchanged. Never coerce clinical decimals through Number.
 */
function clinicalScaledDecimal(value: unknown, scale: number): bigint | null {
  if (typeof value !== "string") {
    if (!value || typeof value !== "object" ||
        !("toString" in value) || typeof value.toString !== "function")
      return null;
    value = value.toString();
  }
  if (typeof value !== "string" ||
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const [integer, fraction = ""] = value.replace(/^-/, "").split(".");
  if (fraction.length > scale) {
    if (fraction.slice(scale).replace(/0/g, "") !== "") return null;
  }
  const significant = fraction.slice(0, scale).padEnd(scale, "0");
  const signed = (value.startsWith("-") ? "-" : "") + integer + significant;
  return BigInt(signed);
}

const intervalTextIdentity = [
  "methodId", "analyzerId", "specimenTypeId", "sex", "ageUnit",
  "pregnancyStatus", "populationCode", "normalTextEn", "normalTextAr",
  "source", "notes",
] as const;
const intervalDecimals = [
  ["ageFrom", 3], ["ageTo", 3],
  ["gestationalAgeFromWeeks", 2], ["gestationalAgeToWeeks", 2],
  ["lowValue", 6], ["highValue", 6], ["criticalLow", 6],
  ["criticalHigh", 6],
] as const;
const intervalDates = ["effectiveTo", "approvedAt", "retiredAt"] as const;

/**
 * Compare the COMPLETE v1 exported clinical parameters to the live interval,
 * without exposing patient/range values in review responses or audit events.
 * Source-staging integrity and qualified signatory policy are separate gates.
 */
export function sameLiveReferenceIntervalMedicalSnapshot(
  sourceData: unknown, liveData: unknown,
): boolean {
  const source = object(sourceData), live = object(liveData);
  if (!source || !live) return false;
  if (!intervalTextIdentity.every(field => Object.hasOwn(source, field) &&
      Object.hasOwn(live, field) && source[field] === live[field])) return false;
  for (const [field, scale] of intervalDecimals) {
    if (!Object.hasOwn(source, field) || !Object.hasOwn(live, field))
      return false;
    if (source[field] === null && live[field] === null) continue;
    if (source[field] === null || live[field] === null) return false;
    const expected = clinicalScaledDecimal(source[field], scale);
    const observed = clinicalScaledDecimal(live[field], scale);
    if (expected === null || observed === null || expected !== observed)
      return false;
  }
  return intervalDates.every(field =>
    Object.hasOwn(source, field) && Object.hasOwn(live, field) &&
    sameOptionalTime(source[field], live[field]));
}

/**
 * Used inside the SAME tenant-locked transaction as the final reviewer audit
 * append. No assumptions about clinical/financial signing authority are made.
 */
export async function validatePolicyReviewBatchScope(
  tx: Prisma.TransactionClient, input: {
    batchId: string; scope: ClinicalImportScope; grantedBranchIds: readonly string[];
    sourceChecksum: string; authorUserId: string; stageEvidenceSeal: unknown;
    batchMetadata: ReviewStageEvidenceBatchMetadata | null;
    signingSecret: string | null;
  },
): Promise<PolicyReviewScopeCheck> {
  const rows = await tx.catalogImportRow.findMany({
    where: { batchId: input.batchId }, orderBy: { rowNumber: "asc" },
    take: BUNDLE_REVIEW_MAX_ROWS + 1,
    select: { id: true, rowNumber: true, entityType: true,
      legacyKey: true, normalizedData: true, sourceData: true,
      validationIssues: true, status: true, importedEntityId: true },
  });
  // A reviewer must not accept individually consistent but independently
  // rewritten DRAFT source/normalized JSON. Verify the signed persisted
  // envelope before any scope, clinical or price comparison.
  if (!input.batchMetadata || !verifyReviewStageEvidence({
    organizationId: input.scope.organizationId, batchId: input.batchId,
    authorUserId: input.authorUserId, sourceChecksum: input.sourceChecksum,
    rows, batchMetadata: input.batchMetadata,
  }, input.stageEvidenceSeal, input.signingSecret))
    return { ok: false, error: "policy_review_source_integrity_error" };
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

  // A count proves visibility, not identity parity. Re-read all directly
  // staged simple masters inside the reviewer transaction; if any changed
  // since the signed source was staged, withhold independent review evidence.
  const directTests = ids.get("TEST") || [];
  const directUnits = ids.get("UNIT") || [];
  const directContainers = ids.get("CONTAINER") || [];
  const [tests, units, containers] = await Promise.all([
    directTests.length ? tx.labTest.findMany({
      where: { ...testScope, id: { in: directTests } },
      select: { id: true, code: true, nameEn: true, departmentId: true, status: true },
    }) : Promise.resolve([]),
    directUnits.length ? tx.unit.findMany({
      where: { organizationId: org, id: { in: directUnits } },
      select: { id: true, code: true, symbol: true, status: true },
    }) : Promise.resolve([]),
    directContainers.length ? tx.container.findMany({
      where: { organizationId: org, id: { in: directContainers } },
      select: { id: true, code: true, nameEn: true, nameAr: true,
        tubeColor: true, additive: true, status: true },
    }) : Promise.resolve([]),
  ]);
  if (tests.length !== directTests.length || units.length !== directUnits.length ||
      containers.length !== directContainers.length)
    return { ok: false, error: "policy_review_batch_scope_changed" };
  const scalarMasters = {
    TEST: new Map(tests.map(row => [row.id, row])),
    UNIT: new Map(units.map(row => [row.id, row])),
    CONTAINER: new Map(containers.map(row => [row.id, row])),
  };
  for (const row of rows) {
    if (row.entityType !== "TEST" && row.entityType !== "UNIT" &&
        row.entityType !== "CONTAINER") continue;
    const n = object(row.normalizedData);
    const live = scalarMasters[row.entityType].get(n?.id as string);
    if (!sameLiveScalarIdentity(row.entityType, n, live))
      return { ok: false, error: "policy_review_batch_scope_changed" };
  }

  // Price-list counts alone allow a same-tenant tariff to be repriced
  // after staging. Re-read direct financial rows with their parent identities
  // before independent reviewer evidence is appended to the audit trail.
  const directLists = ids.get("PRICE_LIST") || [];
  const directTestPrices = ids.get("PRICE_LIST_ITEM") || [];
  const directPackagePrices = ids.get("PRICE_LIST_PACKAGE_ITEM") || [];
  const parentSelect = {
    code: true, scopeType: true, branchId: true, currency: true, status: true,
  } as const;
  const [lists, testPrices, packagePrices] = await Promise.all([
    directLists.length ? tx.priceList.findMany({
      where: { ...priceScope, id: { in: directLists } },
      select: { id: true, ...parentSelect, effectiveFrom: true, effectiveTo: true },
    }) : Promise.resolve([]),
    directTestPrices.length ? tx.priceListItem.findMany({
      where: { priceList: priceScope, test: testScope,
        id: { in: directTestPrices } },
      select: { id: true, priceListId: true, testId: true,
        unitPrice: true, effectiveFrom: true, effectiveTo: true, status: true,
        priceList: { select: parentSelect }, test: { select: { code: true } } },
    }) : Promise.resolve([]),
    directPackagePrices.length ? tx.priceListPackageItem.findMany({
      where: {
        priceList: priceScope,
        package: { organizationId: org, items: fullyVisibleMembership },
        id: { in: directPackagePrices },
      },
      select: { id: true, priceListId: true, packageId: true,
        unitPrice: true, effectiveFrom: true, effectiveTo: true, status: true,
        priceList: { select: parentSelect }, package: { select: { code: true } } },
    }) : Promise.resolve([]),
  ]);
  if (lists.length !== directLists.length ||
      testPrices.length !== directTestPrices.length ||
      packagePrices.length !== directPackagePrices.length)
    return { ok: false, error: "policy_review_batch_scope_changed" };
  const liveTariffs = {
    PRICE_LIST: new Map(lists.map(row => [row.id, row])),
    PRICE_LIST_ITEM: new Map(testPrices.map(row => [row.id, row])),
    PRICE_LIST_PACKAGE_ITEM: new Map(packagePrices.map(row => [row.id, row])),
  };
  for (const row of rows) {
    if (row.entityType !== "PRICE_LIST" &&
        row.entityType !== "PRICE_LIST_ITEM" &&
        row.entityType !== "PRICE_LIST_PACKAGE_ITEM") continue;
    const n = object(row.normalizedData);
    if (!sameLiveTariffReviewIdentity(row.entityType, n, row.sourceData,
        liveTariffs[row.entityType].get(n?.id as string)))
      return { ok: false, error: "policy_review_batch_scope_changed" };
  }

  // Re-check directly staged analyte and reference interval identities
  // with live scoped relationships. Presence/count is insufficient when
  // an analyte is reparented or a range is retired after export.
  const directComponents = ids.get("COMPONENT") || [];
  const directIntervals = ids.get("REFERENCE_INTERVAL") || [];
  const [components, intervals] = await Promise.all([
    directComponents.length ? tx.testComponent.findMany({
      where: { test: testScope, id: { in: directComponents } },
      select: { id: true, testId: true, unitId: true, code: true,
        nameEn: true, status: true, test: { select: { code: true } } },
    }) : Promise.resolve([]),
    directIntervals.length ? tx.referenceInterval.findMany({
      where: { component: { test: testScope }, ...branchScope,
        id: { in: directIntervals } },
      select: { id: true, componentId: true, branchId: true,
        effectiveFrom: true, effectiveTo: true, approvalStatus: true, status: true,
        methodId: true, analyzerId: true, specimenTypeId: true,
        sex: true, ageFrom: true, ageTo: true, ageUnit: true,
        pregnancyStatus: true, gestationalAgeFromWeeks: true,
        gestationalAgeToWeeks: true, populationCode: true,
        lowValue: true, highValue: true, normalTextEn: true,
        normalTextAr: true, criticalLow: true, criticalHigh: true,
        source: true, notes: true, approvedAt: true, retiredAt: true,
        component: { select: {
          code: true, test: { select: { code: true } },
        } } },
    }) : Promise.resolve([]),
  ]);
  if (components.length !== directComponents.length ||
      intervals.length !== directIntervals.length)
    return { ok: false, error: "policy_review_batch_scope_changed" };
  const clinicalMasters = {
    COMPONENT: new Map(components.map(row => [row.id, row])),
    REFERENCE_INTERVAL: new Map(intervals.map(row => [row.id, row])),
  };
  for (const row of rows) {
    if (row.entityType !== "COMPONENT" &&
        row.entityType !== "REFERENCE_INTERVAL") continue;
    const n = object(row.normalizedData);
    const live = clinicalMasters[row.entityType].get(n?.id as string);
    if (!sameLiveClinicalReviewIdentity(row.entityType, n, live))
      return { ok: false, error: "policy_review_batch_scope_changed" };
    if (row.entityType === "REFERENCE_INTERVAL" &&
        !sameLiveReferenceIntervalMedicalSnapshot(row.sourceData, live))
      return { ok: false, error: "policy_review_batch_scope_changed" };
  }

  // Count/scope checks alone permit a changed but still-in-scope member set.
  // Re-read actual membership in the SAME reviewer transaction and compare it
  // against the exact normalized rows whose source identity was validated.
  const panelIds = ids.get("PANEL") || [];
  const packageIds = ids.get("PACKAGE") || [];
  const [panels, packages] = await Promise.all([
    panelIds.length ? tx.testPanel.findMany({
      where: { organizationId: org, id: { in: panelIds },
        items: fullyVisibleMembership },
      select: { id: true, items: { select: {
        testId: true, displayOrder: true, required: true,
      } } },
    }) : Promise.resolve([]),
    packageIds.length ? tx.commercialPackage.findMany({
      where: { organizationId: org, id: { in: packageIds },
        items: fullyVisibleMembership },
      select: { id: true, items: { select: {
        testId: true, displayOrder: true,
      } } },
    }) : Promise.resolve([]),
  ]);
  if (panels.length !== panelIds.length || packages.length !== packageIds.length)
    return { ok: false, error: "policy_review_batch_scope_changed" };
  const panelMap = new Map(panels.map(panel => [panel.id, panel.items]));
  const packageMap = new Map(packages.map(pkg => [pkg.id, pkg.items]));
  for (const row of rows) {
    if (row.entityType !== "PANEL" && row.entityType !== "PACKAGE") continue;
    const n = object(row.normalizedData);
    const live = row.entityType === "PANEL"
      ? panelMap.get(n?.id as string) : packageMap.get(n?.id as string);
    if (!live || !sameLiveMembership(row.entityType, n?.items, live))
      return { ok: false, error: "policy_review_batch_scope_changed" };
  }
  return { ok: true };
}
