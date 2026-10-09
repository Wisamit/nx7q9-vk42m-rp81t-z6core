import type { ImportInputRow } from "./catalog-import";

export const CSV_STAGE_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_STAGE_MAX_ROWS = 20000;
const MAX_COLUMNS = 24;
const MAX_FIELD_LENGTH = 8192;
const HEADERS = new Set([
  "entityType", "legacyKey", "testCode", "code", "nameEn", "nameAr",
  "unitCode", "resultType", "priceListCode", "unitPrice", "effectiveFrom", "effectiveTo",
  "testName", "unit", "sex", "ageFrom", "ageTo", "ageUnit", "low", "high", "normalTextEn",
]);
export const CSV_STAGE_TEMPLATE_HEADERS = [
  "entityType", "legacyKey", "testCode", "code", "nameEn", "nameAr",
  "unitCode", "resultType", "priceListCode", "unitPrice", "effectiveFrom", "effectiveTo",
] as const;
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
    if (entityType !== "COMPONENT" && entityType !== "PRICE_LIST_ITEM" && entityType !== "REFERENCE_INTERVAL") {
      throw new CsvStagingError("csv_entity_review_only");
    }
    const data: Record<string, string> = {};
    for (const key of headers) {
      if (key !== "entityType" && key !== "legacyKey") data[key] = columns[key];
    }
    if ((columns.legacyKey || "").length > 255) throw new CsvStagingError("csv_legacy_key_too_long");
    rows.push({ entityType, legacyKey: columns.legacyKey || undefined, data });
  }
  return rows;
}
