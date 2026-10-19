import type { CatalogExportType } from "./catalog-configuration-export.ts";

/** Bound all fields persisted from caller-controlled review-only source bundles. */
export class BundleSourceBoundaryError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
const common = ["id", "createdAt", "updatedAt", "deactivatedAt"];
const named = ["code", "nameEn", "nameAr", "status"];
const privateIds = ["sourceId", "referrerId", "clientId", "contractId"];
const priceList = [...common, ...named, "scopeType", "branchId", ...privateIds,
  "currency", "priority", "effectiveFrom", "effectiveTo"];
const priceItem = [...common, "priceListId", "unitPrice", "effectiveFrom",
  "effectiveTo", "status", "priceList"];

export const catalogBundleAllowedSourceFields: Record<CatalogExportType, readonly string[]> = {
  TEST: [...common, ...named, "abbreviation", "departmentId", "specimenTypeId",
    "containerId", "methodId", "defaultUnitId", "resultType", "workflowType",
    "resultEntryLayout", "decimalPrecision", "minimumVolume",
    "minimumVolumeUnit", "assay", "tatMinutes", "loincCode"],
  COMPONENT: [...common, ...named, "testId", "unitId", "resultType",
    "decimalPrecision", "displayOrder", "resultSectionId", "reportNameEn",
    "reportNameAr", "reportDisplayOrder", "reportVisible", "entryWidth",
    "entryHintEn", "entryHintAr", "test", "unit"],
  UNIT: [...common, ...named, "symbol", "ucumCode"],
  CONTAINER: [...common, ...named, "tubeColor", "additive"],
  PANEL: [...common, ...named, "descriptionEn", "descriptionAr", "items"],
  PACKAGE: [...common, ...named, "descriptionEn", "descriptionAr", "items"],
  REFERENCE_INTERVAL: [
    "id", "componentId", "branchId", "methodId", "analyzerId",
    "specimenTypeId", "sex", "ageFrom", "ageTo", "ageUnit", "pregnancyStatus",
    "gestationalAgeFromWeeks", "gestationalAgeToWeeks", "populationCode",
    "lowValue", "highValue", "normalTextEn", "normalTextAr",
    "criticalLow", "criticalHigh", "source", "notes", "effectiveFrom",
    "effectiveTo", "approvalStatus", "status", "approvedAt", "retiredAt",
    "createdAt", "updatedAt", "component",
  ],
  PRICE_LIST: priceList,
  PRICE_LIST_ITEM: [...priceItem, "testId", "test"],
  PRICE_LIST_PACKAGE_ITEM: [...priceItem, "packageId", "package"],
};
/**
 * Canonical nested Prisma projection of each exported source class.
 * Required keys are present even when their JSON values are null.
 * Legacy snapshots without a field contract remain unproven review evidence.
 * Array children describe each item, not a separately mutable entity.
 */
export type BundleNestedProjection = {
  readonly [field: string]: true | BundleNestedProjection | readonly [BundleNestedProjection];
};
export const catalogBundleNestedSourceProjections: Record<CatalogExportType, BundleNestedProjection> = {
  TEST: {},
  COMPONENT: { test: { code: true }, unit: { code: true, symbol: true } },
  UNIT: {},
  CONTAINER: {},
  PANEL: { items: [{ testId: true, displayOrder: true, required: true, test: { code: true } }] },
  PACKAGE: { items: [{ testId: true, displayOrder: true, test: { code: true } }] },
  REFERENCE_INTERVAL: { component: { code: true, test: { code: true } } },
  PRICE_LIST: {},
  PRICE_LIST_ITEM: {
    test: { code: true },
    priceList: { code: true, currency: true, scopeType: true, branchId: true,
      status: true, sourceId: true, referrerId: true, clientId: true, contractId: true },
  },
  PRICE_LIST_PACKAGE_ITEM: {
    package: { code: true },
    priceList: { code: true, currency: true, scopeType: true, branchId: true,
      status: true, sourceId: true, referrerId: true, clientId: true, contractId: true },
  },
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new BundleSourceBoundaryError("bundle_unexpected_source_structure");
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, fields: readonly string[]) {
  const allowedKeys = new Set(fields);
  if (Object.keys(value).some(key => !allowedKeys.has(key) ||
      key === "__proto__" || key === "prototype" || key === "constructor"))
    throw new BundleSourceBoundaryError("bundle_unexpected_source_field");
}
function relation(value: unknown, fields: readonly string[], nullable = false) {
  if (nullable && value == null) return;
  keys(object(value), fields);
}
function tariff(value: Record<string, unknown>) {
  if (privateIds.some(field => value[field] != null))
    throw new BundleSourceBoundaryError("bundle_private_tariff_link_forbidden", 403);
  if (value.scopeType !== "ORGANIZATION" && value.scopeType !== "BRANCH")
    throw new BundleSourceBoundaryError("bundle_price_scope_requires_separate_governance", 403);
  if ((value.scopeType === "ORGANIZATION" && value.branchId != null) ||
      (value.scopeType === "BRANCH" && value.branchId == null))
    throw new BundleSourceBoundaryError("bundle_tariff_branch_mismatch");
}

/**
 * Validate each incoming v1 record before master lookups and DRAFT sourceData.
 * This is a source disclosure boundary, not config activation or parity proof.
 */
export function validateBundleSourceBoundary(
  type: CatalogExportType, source: Record<string, unknown>,
): void {
  keys(source, catalogBundleAllowedSourceFields[type]);
  if (type === "COMPONENT") {
    relation(source.test, ["code"]);
    relation(source.unit, ["code", "symbol"], true);
  } else if (type === "REFERENCE_INTERVAL") {
    const component = object(source.component);
    keys(component, ["code", "test"]);
    relation(component.test, ["code"]);
  } else if (type === "PANEL" || type === "PACKAGE") {
    if (!Array.isArray(source.items) || source.items.length > 1000)
      throw new BundleSourceBoundaryError("bundle_invalid_membership_structure");
    for (const raw of source.items) {
      const item = object(raw);
      keys(item, type === "PANEL"
        ? ["testId", "displayOrder", "required", "test"]
        : ["testId", "displayOrder", "test"]);
      relation(item.test, ["code"]);
    }
  } else if (type === "PRICE_LIST") {
    tariff(source);
  } else if (type === "PRICE_LIST_ITEM" || type === "PRICE_LIST_PACKAGE_ITEM") {
    const linked = object(source.priceList);
    keys(linked, ["code", "currency", "scopeType", "branchId", "status", ...privateIds]);
    tariff(linked);
    relation(type === "PRICE_LIST_ITEM" ? source.test : source.package, ["code"]);
  }
}
