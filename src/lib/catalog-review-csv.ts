import type { CatalogExportType } from "./catalog-configuration-export";

const provenanceColumns = ["exportFormat", "schemaVersion", "organizationId", "entityType", "exportedAt", "consistency"] as const;
const limit = 200;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new Error("csv_export_record_not_object");
  }
  return value as Record<string, unknown>;
}

function flatten(value: Record<string, unknown>, prefix = "", result = new Map<string, string>()): Map<string, string> {
  for (const [key, item] of Object.entries(value)) {
    if (!key || key.includes(".") || /[\r\n]/.test(key)) throw new Error("csv_export_invalid_field");
    const path = prefix ? prefix + "." + key : key;
    if (result.has(path)) throw new Error("csv_export_ambiguous_field");
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      flatten(record(item), path, result);
    } else {
      if (item !== null && typeof item !== "string" && typeof item !== "number" && typeof item !== "boolean" && !Array.isArray(item)) {
        throw new Error("csv_export_unsupported_value");
      }
      // API JSON has already serialized Prisma.Decimal to an exact string.
      // Arrays, if introduced in a later schema, remain JSON text rather than being dropped.
      result.set(path, item === null ? "" : Array.isArray(item) ? JSON.stringify(item) : String(item));
    }
  }
  return result;
}

export function safeSpreadsheetCell(value: string): string {
  // Quoted CSV alone does not prevent spreadsheet software executing formulas.
  // Preserve valid signed numeric values; prefix other formula-like text with an apostrophe.
  const signedNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
  const hazardous = /^[\s\uFEFF\u200B-\u200D]*[=+\-@]/u;
  const protectedValue = hazardous.test(value) && !signedNumber.test(value) ? "'" + value : value;
  return '"' + protectedValue.replace(/"/g, '""') + '"';
}

/**
 * Human-review CSV, not a lossless machine restore format.
 * Each file contains one catalog entity type and the source export provenance.
 * The JSON bundle remains authoritative for preserving exact structured values.
 */
export function catalogReviewCsv(
  batch: { entityType: CatalogExportType; records: readonly unknown[] },
  organizationId: string,
  exportedAt: string,
  consistency: "paged-live-not-atomic" | "transactional-consistent-read" =
    "paged-live-not-atomic",
): string {
  if (!organizationId || !Number.isFinite(Date.parse(exportedAt))) {
    throw new Error("csv_export_missing_provenance");
  }
  const rows = batch.records.map(item => flatten(record(item)));
  const keys = [...new Set(rows.flatMap(row => [...row.keys()]))].sort((a, b) => a.localeCompare(b, "en"));
  if (keys.length > limit) throw new Error("csv_export_too_many_columns");
  if (keys.some(key => (provenanceColumns as readonly string[]).includes(key))) {
    throw new Error("csv_export_reserved_field_collision");
  }
  const headers = [...provenanceColumns, ...keys];
  const prefix = ["family-lab-catalog-review-csv", "1", organizationId,
    batch.entityType, exportedAt, consistency];
  const lines = [
    headers.map(safeSpreadsheetCell).join(","),
    ...rows.map(row => [...prefix, ...keys.map(key => row.get(key) ?? "")]
      .map(safeSpreadsheetCell).join(",")),
  ];
  // The UTF-8 BOM improves Excel import of Arabic names; CRLF is conventional CSV.
  return "\uFEFF" + lines.join("\r\n") + "\r\n";
}
