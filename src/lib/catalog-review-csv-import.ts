import type { ImportEntity, ImportInputRow } from "./catalog-import";

export const CSV_STAGE_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_STAGE_MAX_ROWS = 20000;
const MAX_COLUMNS = 32;
const MAX_FIELD_LENGTH = 8192;
const HEADERS = new Set([
  "entityType", "legacyKey", "testCode", "code", "nameEn", "nameAr",
  "unitCode", "resultType", "priceListCode", "unitPrice", "effectiveFrom", "effectiveTo",
  "testName", "unit", "sex", "ageFrom", "ageTo", "ageUnit", "low", "high", "normalTextEn",
  "symbol", "memberTestCodes", "packageCode",
  "scopeType", "branchId", "currency", "priority",
  "ucumCode", "tubeColor", "additive",
]);
export const CSV_STAGE_TEMPLATE_HEADERS = [
  "entityType", "legacyKey", "testCode", "code", "nameEn", "nameAr",
  "unitCode", "resultType", "priceListCode", "unitPrice", "effectiveFrom", "effectiveTo",
] as const;
export const CSV_STAGE_MASTER_TEMPLATE_HEADERS = [
  "entityType", "legacyKey", "code", "nameEn", "nameAr", "symbol", "memberTestCodes",
  "ucumCode", "tubeColor", "additive",
] as const;
export const CSV_STAGE_PRICE_LIST_TEMPLATE_HEADERS = [
  "entityType", "legacyKey", "code", "nameEn", "nameAr", "scopeType",
  "branchId", "currency", "priority", "effectiveFrom", "effectiveTo",
] as const;
export const CSV_STAGE_PACKAGE_PRICE_TEMPLATE_HEADERS = [
  "entityType", "legacyKey", "priceListCode", "packageCode", "unitPrice", "effectiveFrom", "effectiveTo",
] as const;
export const CSV_REVIEW_ENTITY_TYPES = new Set([
  "TEST", "UNIT", "PANEL", "PACKAGE", "CONTAINER", "COMPONENT",
  "REFERENCE_INTERVAL", "PRICE_LIST", "PRICE_LIST_ITEM", "PRICE_LIST_PACKAGE_ITEM",
] as const);
export const CSV_STAGE_RANGE_TEMPLATE_HEADERS = [
  "entityType", "legacyKey", "testName", "unit", "sex",
  "ageFrom", "ageTo", "ageUnit", "low", "high", "normalTextEn",
] as const;

export class CsvStagingError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.reason = reason;
  }
}

/** Strict RFC4180-compatible quoted cells with CRLF/LF records. Never evaluate formulas. */
export function parseCsvReviewFile(source: string): ImportInputRow[] {
  if (Buffer.byteLength(source, "utf8") > CSV_STAGE_MAX_BYTES) {
    throw new CsvStagingError("csv_file_too_large");
  }
  const csv = source.startsWith("\uFEFF") ? source.slice(1) : source;
  if (!csv || csv.includes("\0")) throw new CsvStagingError("csv_invalid_content");
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let state: "START" | "PLAIN" | "QUOTED" | "END_QUOTE" = "START";

  const pushCell = () => {
    if (cell.length > MAX_FIELD_LENGTH) throw new CsvStagingError("csv_field_too_long");
    row.push(cell);
    if (row.length > MAX_COLUMNS) throw new CsvStagingError("csv_too_many_columns");
    cell = ""; state = "START";
  };
  const pushRow = () => {
    pushCell();
    if (records.length === 0 || row.some(value => value !== "")) records.push(row);
    else throw new CsvStagingError("csv_empty_record");
    if (records.length > CSV_STAGE_MAX_ROWS + 1) throw new CsvStagingError("csv_too_many_rows");
    row = [];
  };

  for (let i = 0; i < csv.length; i++) {
    const char = csv[i];
    if (state === "QUOTED") {
      if (char === '"') {
        if (csv[i + 1] === '"') { cell += '"'; i++; }
        else state = "END_QUOTE";
      } else cell += char;
    } else if (char === ",") {
      pushCell();
    } else if (char === "\r" || char === "\n") {
      if (char === "\r" && csv[i + 1] !== "\n") throw new CsvStagingError("csv_invalid_line_ending");
      if (char === "\r") i++;
      pushRow();
    } else if (state === "END_QUOTE") {
      throw new CsvStagingError("csv_unexpected_after_quote");
    } else if (char === '"') {
      if (state !== "START") throw new CsvStagingError("csv_unescaped_quote");
      state = "QUOTED";
    } else {
      cell += char;
      state = "PLAIN";
    }
    if (cell.length > MAX_FIELD_LENGTH) throw new CsvStagingError("csv_field_too_long");
  }
  if (state === "QUOTED") throw new CsvStagingError("csv_unclosed_quote");
  if (cell.length || row.length || state === "END_QUOTE") pushRow();
  if (records.length < 2) throw new CsvStagingError("csv_missing_rows");
  const headers = records[0];
  if (!headers.includes("entityType") || headers.length > MAX_COLUMNS ||
      headers.some(header => !HEADERS.has(header)) ||
      new Set(headers).size !== headers.length) {
    throw new CsvStagingError("csv_invalid_headers");
  }

  const rows: ImportInputRow[] = [];
  for (const fields of records.slice(1)) {
    if (fields.length !== headers.length) throw new CsvStagingError("csv_column_count_mismatch");
    const columns = Object.fromEntries(headers.map((key, index) => [key, fields[index]])) as Record<string, string>;
    const entityType = columns.entityType?.trim();
    if (!CSV_REVIEW_ENTITY_TYPES.has(entityType as ImportEntity)) {
      throw new CsvStagingError("csv_entity_review_only");
    }
    const data: Record<string, string | string[]> = {};
    for (const key of headers) {
      if (key !== "entityType" && key !== "legacyKey") data[key] = columns[key];
    }
    if ((columns.legacyKey || "").length > 255) throw new CsvStagingError("csv_legacy_key_too_long");
    if (entityType === "PANEL" || entityType === "PACKAGE") {
      // User-entered membership must be a JSON array of explicit test codes.
      // Malformed input is kept verbatim in the staged source but must fail validation.
      try {
        const members = JSON.parse(columns.memberTestCodes ?? "");
        if (Array.isArray(members) && members.length <= 300 &&
            members.every(value => typeof value === "string")) data.memberTestCodes = members;
      } catch { /* Normalizer will reject missing/invalid membership. */ }
    }
    rows.push({ entityType: entityType as ImportEntity, legacyKey: columns.legacyKey || undefined, data });
  }
  return rows;
}
