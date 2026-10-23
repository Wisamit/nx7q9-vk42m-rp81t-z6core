import type { CatalogExportType } from "./catalog-configuration-export";
import { safeSpreadsheetCell } from "./catalog-review-csv.ts";
import { parseCsvReviewFile } from "./catalog-review-csv-import.ts";
import { normalizeImportRow, rowValidationStatus, validateImportRow } from "./catalog-import.ts";
import { validateExpandedCsvReviewRow } from "./catalog-expanded-csv-review.ts";
import { validateRangeCsvReview } from "./catalog-range-csv-review.ts";
import { csvReviewBatchConflictIssues, csvReviewTariffRowIssues } from "./catalog-csv-review-integrity.ts";

/**
 * Canonical, review-only staging projection of an atomic source export.
 * This is intentionally NOT a lossless source archive, restore or activation.
 * The original signed JSON bundle is the full structured evidence.
 */
export class CanonicalSpreadsheetReviewError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

const columns = {
  TEST: ["code", "nameEn", "nameAr"],
  COMPONENT: ["testCode", "code", "nameEn", "nameAr", "unitCode", "resultType"],
  UNIT: ["code", "nameEn", "nameAr", "symbol", "ucumCode"],
  CONTAINER: ["code", "nameEn", "nameAr", "tubeColor", "additive"],
  PANEL: ["code", "nameEn", "nameAr", "memberTestCodes"],
  PACKAGE: ["code", "nameEn", "nameAr", "memberTestCodes"],
  PRICE_LIST: ["code", "nameEn", "nameAr", "scopeType", "branchId", "currency",
    "priority", "effectiveFrom", "effectiveTo"],
  PRICE_LIST_ITEM: ["priceListCode", "testCode", "unitPrice", "effectiveFrom", "effectiveTo"],
  PRICE_LIST_PACKAGE_ITEM: ["priceListCode", "packageCode", "unitPrice", "effectiveFrom", "effectiveTo"],
} as const;

export type CanonicalSpreadsheetReviewType = keyof typeof columns;

export function supportsCanonicalSpreadsheetReview(
  type: CatalogExportType,
): type is CanonicalSpreadsheetReviewType {
  return Object.prototype.hasOwnProperty.call(columns, type);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CanonicalSpreadsheetReviewError("canonical_source_record_invalid");
  }
  return value as Record<string, unknown>;
}

function string(source: Record<string, unknown>, name: string, nullable = false): string {
  const value = source[name];
  if (nullable && value == null) return "";
  if (typeof value !== "string" || value.length > 8192 || value.includes("\0")) {
    throw new CanonicalSpreadsheetReviewError("canonical_source_field_invalid:" + name);
  }
  return value;
}

function optionalString(source: Record<string, unknown>, name: string): string {
  return string(source, name, true);
}

function exactNumber(source: Record<string, unknown>, name: string): string {
  const value = source[name];
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(value)) return value;
  throw new CanonicalSpreadsheetReviewError("canonical_non_exact_number:" + name);
}

function dateTime(source: Record<string, unknown>, name: string): string {
  const value = source[name];
  if (value === null && name === "effectiveTo") return "";
  // Prisma dates in signed JSON are explicit UTC ISO strings, never local display dates.
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new CanonicalSpreadsheetReviewError("canonical_source_date_ambiguous:" + name);
  }
  return value;
}

function priceListDay(source: Record<string, unknown>, name: string): string {
  const value = dateTime(source, name);
  if (!value) return "";
  if (!value.endsWith("T00:00:00.000Z")) {
    throw new CanonicalSpreadsheetReviewError("canonical_price_list_local_date_ambiguous");
  }
  return value.slice(0, 10);
}

function linkedCode(source: Record<string, unknown>, relation: string): string {
  return string(object(source[relation]), "code");
}

function safePriceListCode(source: Record<string, unknown>): string {
  const priceList = object(source.priceList);
  // The nested scope must be complete, not merely a public price-list code.
  // A client/contract tariff is never projected as a generic price-list row.
  for (const key of ["sourceId", "referrerId", "clientId", "contractId"]) {
    if (!Object.prototype.hasOwnProperty.call(priceList, key) || priceList[key] !== null) {
      throw new CanonicalSpreadsheetReviewError("canonical_price_list_context_unsupported");
    }
  }
  if (priceList.status !== "ACTIVE" ||
      !["ORGANIZATION", "BRANCH"].includes(String(priceList.scopeType)) ||
      (priceList.scopeType === "ORGANIZATION" && priceList.branchId !== null) ||
      (priceList.scopeType === "BRANCH" &&
        (typeof priceList.branchId !== "string" || !priceList.branchId))) {
    throw new CanonicalSpreadsheetReviewError("canonical_price_list_context_unsupported");
  }
  return string(priceList, "code");
}

function members(source: Record<string, unknown>): string {
  if (!Array.isArray(source.items) || !source.items.length ||
      source.items.length > 300) {
    throw new CanonicalSpreadsheetReviewError("canonical_membership_missing");
  }
  const list = source.items.map(entry => linkedCode(object(entry), "test"));
  if (new Set(list).size !== list.length) {
    throw new CanonicalSpreadsheetReviewError("canonical_membership_duplicate");
  }
  return JSON.stringify(list);
}

function project(type: CanonicalSpreadsheetReviewType, source: Record<string, unknown>): Record<string, string> {
  if (source.status !== "ACTIVE") {
    // An inactive historic source must not silently become an activatable new master.
    throw new CanonicalSpreadsheetReviewError("canonical_inactive_source_requires_manual_review");
  }
  const basic = () => ({ code: string(source, "code"), nameEn: string(source, "nameEn"),
    nameAr: optionalString(source, "nameAr") });
  switch (type) {
    case "TEST": return basic();
    case "CONTAINER": return { ...basic(), tubeColor: optionalString(source, "tubeColor"),
      additive: optionalString(source, "additive") };
    case "UNIT": return { ...basic(), symbol: string(source, "symbol"),
      ucumCode: optionalString(source, "ucumCode") };
    case "COMPONENT": return {
      testCode: linkedCode(source, "test"), ...basic(),
      unitCode: source.unit == null ? "" : linkedCode(source, "unit"),
      resultType: string(source, "resultType"),
    };
    case "PANEL":
    case "PACKAGE": return { ...basic(), memberTestCodes: members(source) };
    case "PRICE_LIST":
      if (["sourceId", "referrerId", "clientId", "contractId"].some(k => source[k] != null) ||
          !["ORGANIZATION", "BRANCH"].includes(String(source.scopeType))) {
        throw new CanonicalSpreadsheetReviewError("canonical_contract_price_list_not_supported");
      }
      return { ...basic(), scopeType: string(source, "scopeType"),
        branchId: optionalString(source, "branchId"), currency: string(source, "currency"),
        priority: source.priority == null ? "" : String(source.priority),
        effectiveFrom: priceListDay(source, "effectiveFrom"),
        effectiveTo: priceListDay(source, "effectiveTo") };
    case "PRICE_LIST_ITEM":
      return { priceListCode: safePriceListCode(source),
        testCode: linkedCode(source, "test"),
        unitPrice: exactNumber(source, "unitPrice"),
        effectiveFrom: dateTime(source, "effectiveFrom"),
        effectiveTo: dateTime(source, "effectiveTo") };
    case "PRICE_LIST_PACKAGE_ITEM":
      return { priceListCode: safePriceListCode(source),
        packageCode: linkedCode(source, "package"),
        unitPrice: exactNumber(source, "unitPrice"),
        effectiveFrom: dateTime(source, "effectiveFrom"),
        effectiveTo: dateTime(source, "effectiveTo") };
  }
}

function csvLiteral(value: string): string {
  // A leading spreadsheet formula escape apostrophe changes data on CSV re-import.
  // Reject rather than alter a real master name, code, unit, or other value.
  if (/^[\s\uFEFF\u200B-\u200D]*[=+\-@]/u.test(value) &&
      !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)) {
    throw new CanonicalSpreadsheetReviewError("canonical_spreadsheet_formula_like_value");
  }
  return safeSpreadsheetCell(value);
}

export function canonicalStagingCsvFromAtomicGroup(
  batch: { entityType: CatalogExportType; records: readonly unknown[] },
): string {
  if (!supportsCanonicalSpreadsheetReview(batch.entityType)) {
    throw new CanonicalSpreadsheetReviewError("canonical_mapping_requires_professional_review");
  }
  if (batch.records.length < 1 || batch.records.length > 20000) {
    throw new CanonicalSpreadsheetReviewError("canonical_row_limit");
  }
  const keys = columns[batch.entityType] as readonly string[];
  const header = ["entityType", "legacyKey", ...keys];
  const sourceIds = new Set<string>();
  const rows = batch.records.map(item => {
    const source = object(item);
    const id = string(source, "id");
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      throw new CanonicalSpreadsheetReviewError("canonical_missing_source_identity");
    }
    if (sourceIds.has(id.toLowerCase())) {
      throw new CanonicalSpreadsheetReviewError("canonical_duplicate_source_identity");
    }
    sourceIds.add(id.toLowerCase());
    const fields = project(batch.entityType as CanonicalSpreadsheetReviewType, source);
    return [batch.entityType, id, ...keys.map(key => fields[key] ?? "")];
  });
  const csv = "\uFEFF" + [header, ...rows]
    .map(row => row.map(csvLiteral).join(",")).join("\r\n") + "\r\n";
  if (new TextEncoder().encode(csv).byteLength > 2 * 1024 * 1024) {
    throw new CanonicalSpreadsheetReviewError("canonical_review_file_exceeds_staging_limit");
  }
  // The generated file MUST pass the exact intake parser and validators now.
  const parsed = parseCsvReviewFile(csv);
  if (parsed.length !== batch.records.length) {
    throw new CanonicalSpreadsheetReviewError("canonical_row_count_changed");
  }
  const normalizedRows = parsed.map(row => normalizeImportRow(row));
  const conflicts = csvReviewBatchConflictIssues(parsed.map((row, index) => ({
    entityType: row.entityType, normalized: normalizedRows[index],
  })));
  for (const [index, row] of parsed.entries()) {
    const normalized = normalizedRows[index];
    // A review worksheet is deliberately not a complete restore; nevertheless,
    // every field that the sheet DOES map must survive its canonical intake
    // verbatim. Silent trimming, code case changes, or missing bilingual
    // source fields would otherwise hide a real configuration drift.
    const originals = rows[index];
    for (const [offset, key] of keys.entries()) {
      const projected = originals[offset + 2];
      const observed = normalized[key];
      const equal = key === "memberTestCodes"
        ? Array.isArray(observed) &&
          JSON.stringify(observed) === projected
        : typeof observed === "string" && observed === projected;
      if (!equal) {
        throw new CanonicalSpreadsheetReviewError(
          "canonical_normalization_not_lossless:" + key);
      }
    }
    const issues = [
      ...validateImportRow(row.entityType, normalized),
      ...validateExpandedCsvReviewRow(row.entityType, normalized),
      ...validateRangeCsvReview(row),
      ...csvReviewTariffRowIssues(row.entityType, normalized),
      ...conflicts[index],
    ];
    if (rowValidationStatus(issues) === "ERROR") {
      throw new CanonicalSpreadsheetReviewError("canonical_source_requires_manual_mapping:" +
        issues.filter(issue => issue.severity === "ERROR").map(issue => issue.code).join(","));
    }
  }
  return csv;
}
