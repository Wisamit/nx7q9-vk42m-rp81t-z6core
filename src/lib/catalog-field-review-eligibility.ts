import { catalogBundleAllowedSourceFields, catalogBundleNestedSourceProjections,
  type BundleNestedProjection } from "./catalog-bundle-source-boundary.ts";
import { catalogExportTypes, type CatalogExportType } from "./catalog-configuration-export.ts";
import { bundleTriageClass } from "./catalog-drift-triage.ts";

export type FieldReviewClass =
  "IMMUTABLE_SYSTEM" | "IDENTITY_RECONCILIATION" |
  "CLINICAL_VERSIONED_REVIEW" | "FINANCIAL_VERSIONED_REVIEW" |
  "CROSS_DOMAIN_VERSIONED_REVIEW" | "UNMAPPED_BLOCKED";

const immutable = new Set([
  "id", "createdAt", "updatedAt", "deactivatedAt", "approvedAt", "retiredAt",
]);
const reconciled = new Set([
  "code", "departmentId", "specimenTypeId", "containerId", "methodId",
  "defaultUnitId", "resultSectionId", "testId", "unitId", "componentId",
  "branchId", "analyzerId", "priceListId", "packageId",
  "sourceId", "referrerId", "clientId", "contractId",
  "test", "unit", "component", "priceList", "package", "items",
  "loincCode", "ucumCode", "scopeType", "currency",
]);
const versioned = new Set([
  "nameEn", "nameAr", "status", "abbreviation", "resultType",
  "workflowType", "resultEntryLayout", "decimalPrecision", "minimumVolume",
  "minimumVolumeUnit", "assay", "tatMinutes", "symbol", "tubeColor",
  "additive", "displayOrder", "reportNameEn", "reportNameAr",
  "reportDisplayOrder", "reportVisible", "entryWidth", "entryHintEn",
  "entryHintAr", "descriptionEn", "descriptionAr", "sex",
  "ageFrom", "ageTo", "ageUnit", "pregnancyStatus",
  "gestationalAgeFromWeeks", "gestationalAgeToWeeks", "populationCode",
  "lowValue", "highValue", "normalTextEn", "normalTextAr", "criticalLow",
  "criticalHigh", "source", "notes", "effectiveFrom", "effectiveTo",
  "approvalStatus", "priority", "unitPrice",
]);

/** No new export field can quietly acquire implicit application eligibility. */
export function catalogFieldCoverageGaps(): string[] {
  const gaps: string[] = [];
  for (const type of catalogExportTypes) {
    for (const field of catalogBundleAllowedSourceFields[type]) {
      const matches = [immutable, reconciled, versioned]
        .filter(group => group.has(field)).length;
      if (matches !== 1) gaps.push(type + "." + field);
    }
  }
  return gaps;
}

function nestedPaths(shape: BundleNestedProjection, prefix = ""): Set<string> {
  const paths = new Set<string>();
  for (const [field, child] of Object.entries(shape)) {
    const path = prefix ? prefix + "." + field : field;
    paths.add(path);
    if (Array.isArray(child)) {
      paths.add(path + ".length");
      paths.add(path + "[]");
      for (const nested of nestedPaths(child[0], path + "[]")) paths.add(nested);
    } else if (child !== true) {
      for (const nested of nestedPaths(child as BundleNestedProjection, path)) paths.add(nested);
    }
  }
  return paths;
}

export function classifyCatalogReviewField(type: string, path: string): FieldReviewClass {
  if (!catalogExportTypes.has(type as CatalogExportType) ||
      typeof path !== "string" || !/^[A-Za-z0-9_.]+$/.test(path)) return "UNMAPPED_BLOCKED";
  const kind = type as CatalogExportType;
  const canonical = path.replace(/\.\d+(?=\.|$)/g, "[]");
  const root = canonical.split(/[.\[]/)[0];
  if (!catalogBundleAllowedSourceFields[kind].includes(root)) return "UNMAPPED_BLOCKED";
  if (root !== canonical &&
      !nestedPaths(catalogBundleNestedSourceProjections[kind]).has(canonical))
    return "UNMAPPED_BLOCKED";
  if (immutable.has(root)) return "IMMUTABLE_SYSTEM";
  if (reconciled.has(root)) return "IDENTITY_RECONCILIATION";
  if (!versioned.has(root)) return "UNMAPPED_BLOCKED";
  const domain = bundleTriageClass(kind);
  return domain === "CLINICAL" ? "CLINICAL_VERSIONED_REVIEW" :
    domain === "FINANCIAL" ? "FINANCIAL_VERSIONED_REVIEW" :
    domain === "CROSS_DOMAIN" ? "CROSS_DOMAIN_VERSIONED_REVIEW" :
    "UNMAPPED_BLOCKED";
}

/**
 * Descriptive classification for a bounded, read-only drift observation.
 * Never an allowlist for mutation, professional approval, or silent field
 * discard. An omitted or unknown path is specifically NOT complete evidence.
 */
export function classifyCatalogReviewDrift(
  type: string, changedFields: readonly string[], additionalFieldsOmitted: boolean,
) {
  if (!Array.isArray(changedFields) || changedFields.length > 100 ||
      changedFields.some(path => typeof path !== "string") ||
      typeof additionalFieldsOmitted !== "boolean") throw Error("field_review_invalid_observation");
  const fields = changedFields.map(path => ({
    path, classification: classifyCatalogReviewField(type, path),
  }));
  const unsupported = fields.some(field => field.classification === "UNMAPPED_BLOCKED");
  return {
    fields,
    completeFieldInventory: !additionalFieldsOmitted && !unsupported,
    unmappedFieldPresent: unsupported,
    reviewOnly: true as const, autoApplyAllowed: false as const,
    qualifiedApprovalRequired: true as const,
    versionedApplicationRequired: true as const,
  };
}
