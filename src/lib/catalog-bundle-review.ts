import { catalogExportTypes, type CatalogExportType } from "./catalog-configuration-export.ts";
import { CompositeBundleError, parseCompositeBundleRow } from "./catalog-composite-bundle.ts";

export const BUNDLE_REVIEW_SOURCE = "CONFIG_BUNDLE_REVIEW";
export const BUNDLE_REVIEW_MAX_BYTES = 4 * 1024 * 1024;
export const BUNDLE_REVIEW_MAX_ROWS = 5000;

export function isReviewOnlyCatalogSource(type: string): boolean {
  return type === "CSV_REVIEW" || type === BUNDLE_REVIEW_SOURCE;
}

export class CatalogBundleReviewError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export type BundleReviewRow = {
  entityType: CatalogExportType;
  original: Record<string, unknown>;
  normalized: Record<string, unknown>;
  identity: string;
};

export type BundleReview = {
  rows: BundleReviewRow[];
  counts: Record<string, number>;
  exportedAt: string;
  consistency: "paged-live-not-atomic" | "transactional-consistent-read";
  ids: {
    tests: string[];
    units: string[];
    components: string[];
    intervals: string[];
    priceLists: string[];
    prices: string[];
    panels: string[];
    packages: string[];
    packagePrices: string[];
    memberTests: string[];
    compositePriceLists: string[];
    pricedPackages: string[];
  };
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CatalogBundleReviewError("bundle_record_not_object");
  }
  return value as Record<string, unknown>;
}
function requiredId(value: unknown): string {
  if (typeof value !== "string" || !uuid.test(value)) {
    throw new CatalogBundleReviewError("bundle_invalid_record_id");
  }
  return value.toLowerCase();
}
function optionalId(value: unknown): string | null {
  return value === null || value === undefined ? null : requiredId(value);
}
function string(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new CatalogBundleReviewError("bundle_invalid_identity");
  }
  return value;
}
function linkedCode(value: unknown): string {
  return string(record(value).code, 80);
}
function iso(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    throw new CatalogBundleReviewError("bundle_invalid_export_date");
  }
  return value;
}

/**
 * Review-only projection of the nine-class JSON format exported by our LIS.
 * Original source values remain intact. UUIDs identify *current* masters for
 * tenant/branch authorization, never migration targets or commit authority.
 */
export function parseCatalogBundleForReview(
  value: unknown, organizationId: string,
  permissions: { pricing: boolean; ranges: boolean },
): BundleReview {
  const bundle = record(value);
  if (bundle.format !== "family-lab-catalog-bundle" || bundle.schemaVersion !== 1 ||
      bundle.consistency !== "paged-live-not-atomic" &&
      bundle.consistency !== "transactional-consistent-read") {
    throw new CatalogBundleReviewError("bundle_unsupported_format");
  }
  if (bundle.organizationId !== organizationId) {
    throw new CatalogBundleReviewError("bundle_foreign_organization", 403);
  }
  const exportedAt = iso(bundle.exportedAt);
  if (!Array.isArray(bundle.groups) || bundle.groups.length < 1 || bundle.groups.length > 9) {
    throw new CatalogBundleReviewError("bundle_invalid_groups");
  }
  const seenGroups = new Set<string>();
  const seenIds = new Set<string>();
  const rows: BundleReviewRow[] = [];
  const counts: Record<string, number> = {};
  const ids = { tests: [] as string[], units: [] as string[], components: [] as string[],
    intervals: [] as string[], priceLists: [] as string[], prices: [] as string[],
    panels: [] as string[], packages: [] as string[], packagePrices: [] as string[],
    memberTests: [] as string[], compositePriceLists: [] as string[], pricedPackages: [] as string[] };

  for (const rawGroup of bundle.groups) {
    const group = record(rawGroup);
    const entityType = group.entityType;
    if (typeof entityType !== "string" || !catalogExportTypes.has(entityType as CatalogExportType) ||
        seenGroups.has(entityType) || !Array.isArray(group.records)) {
      throw new CatalogBundleReviewError("bundle_invalid_group");
    }
    seenGroups.add(entityType);
    if ((entityType === "PRICE_LIST" || entityType === "PRICE_LIST_ITEM" ||
         entityType === "PRICE_LIST_PACKAGE_ITEM") && !permissions.pricing) {
      throw new CatalogBundleReviewError("pricing_manage_required", 403);
    }
    if (entityType === "REFERENCE_INTERVAL" && !permissions.ranges) {
      throw new CatalogBundleReviewError("reference_ranges_manage_required", 403);
    }
    for (const raw of group.records) {
      if (rows.length >= BUNDLE_REVIEW_MAX_ROWS) {
        throw new CatalogBundleReviewError("bundle_too_many_rows", 413);
      }
      const source = record(raw);
      const id = requiredId(source.id);
      // Never silently accept the same master more than once in this review.
      if (seenIds.has(entityType + ":" + id)) {
        throw new CatalogBundleReviewError("bundle_duplicate_master");
      }
      seenIds.add(entityType + ":" + id);
      let normalized: Record<string, unknown>;
      if (entityType === "TEST") {
        ids.tests.push(id);
        normalized = { id, code: string(source.code, 80), nameEn: string(source.nameEn, 200),
          departmentId: optionalId(source.departmentId), status: source.status };
      } else if (entityType === "UNIT") {
        ids.units.push(id);
        normalized = { id, code: string(source.code, 50), symbol: string(source.symbol, 50),
          status: source.status };
      } else if (entityType === "COMPONENT") {
        ids.components.push(id);
        normalized = { id, testId: requiredId(source.testId),
          testCode: linkedCode(source.test),
          code: string(source.code, 80), nameEn: string(source.nameEn, 200),
          unitId: optionalId(source.unitId), status: source.status };
      } else if (entityType === "PANEL" || entityType === "PACKAGE" ||
                 entityType === "PRICE_LIST_PACKAGE_ITEM") {
        try {
          const composite = parseCompositeBundleRow(entityType, source);
          normalized = composite as Record<string, unknown>;
          if (entityType === "PANEL") ids.panels.push(id);
          if (entityType === "PACKAGE") ids.packages.push(id);
          if (composite.items) ids.memberTests.push(...composite.items.map(item => item.testId));
          if (entityType === "PRICE_LIST_PACKAGE_ITEM") {
            ids.packagePrices.push(id);
            ids.compositePriceLists.push(composite.priceListId!);
            ids.pricedPackages.push(composite.packageId!);
          }
        } catch (error) {
          if (error instanceof CompositeBundleError)
            throw new CatalogBundleReviewError(error.code);
          throw error;
        }
      } else if (entityType === "REFERENCE_INTERVAL") {
        ids.intervals.push(id);
        normalized = { id, componentId: requiredId(source.componentId),
          testCode: linkedCode(record(source.component).test),
          componentCode: linkedCode(source.component),
          branchId: optionalId(source.branchId), effectiveFrom: iso(source.effectiveFrom),
          approvalStatus: source.approvalStatus, status: source.status };
      } else if (entityType === "PRICE_LIST") {
        ids.priceLists.push(id);
        if (source.scopeType !== "ORGANIZATION" && source.scopeType !== "BRANCH") {
          throw new CatalogBundleReviewError("bundle_price_scope_requires_separate_governance", 403);
        }
        normalized = { id, code: string(source.code, 80), currency: string(source.currency, 3),
          scopeType: source.scopeType, branchId: optionalId(source.branchId), status: source.status };
      } else {
        ids.prices.push(id);
        const parent = record(source.priceList);
        if (parent.scopeType !== "ORGANIZATION" && parent.scopeType !== "BRANCH") {
          throw new CatalogBundleReviewError("bundle_price_scope_requires_separate_governance", 403);
        }
        if (typeof source.unitPrice !== "string" ||
            !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(source.unitPrice)) {
          throw new CatalogBundleReviewError("bundle_invalid_decimal_price");
        }
        normalized = { id, priceListId: requiredId(source.priceListId),
          testId: requiredId(source.testId), testCode: linkedCode(source.test),
          priceListCode: linkedCode(parent), scopeType: parent.scopeType,
          branchId: optionalId(parent.branchId),
          unitPrice: source.unitPrice, effectiveFrom: iso(source.effectiveFrom),
          status: source.status };
      }
      rows.push({ entityType: entityType as CatalogExportType, original: source, normalized,
        identity: id });
      counts[entityType] = (counts[entityType] || 0) + 1;
    }
  }
  if (!rows.length) throw new CatalogBundleReviewError("bundle_empty");
  return { rows, counts, exportedAt, consistency: bundle.consistency as BundleReview["consistency"], ids };
}
