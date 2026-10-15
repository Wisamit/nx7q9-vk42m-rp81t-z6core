import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogReviewXlsx } from "../src/lib/catalog-review-xlsx.ts";
import { xlsxReviewToCsv, XlsxStagingError } from "../src/lib/catalog-review-xlsx-import.ts";
import { parseCsvReviewFile } from "../src/lib/catalog-review-csv-import.ts";

const fields = "entityType,legacyKey,testCode,code,nameEn,nameAr,unitCode,resultType,priceListCode,unitPrice,effectiveFrom,effectiveTo";
const csv = [
  fields,
  'COMPONENT,C136,TSH,TSH_FT4,"Free, T4",هرمون,PMOL,NUMERIC,,,,',
  'PRICE_LIST_ITEM,P136,TSH,,,,,,ORG_AED,123.4500,2026-10-15,',
].join("\r\n") + "\r\n";

function crc32(buffer: Uint8Array) {
  let checksum = 0xffffffff;
  for (const value of buffer) {
    checksum ^= value;
    for (let i = 0; i < 8; i++)
      checksum = (checksum >>> 1) ^ (0xedb88320 & -(checksum & 1));
  }
  return (checksum ^ 0xffffffff) >>> 0;
}

/** Corrupt an individual worksheet tag while preserving ZIP sizes and both CRCs. */
function replaceWorksheetTag(bytes: Uint8Array, before: string, after: string): Uint8Array {
  assert.equal(Buffer.byteLength(before), Buffer.byteLength(after));
  const output = Buffer.from(bytes);
  const label = Buffer.from("xl/worksheets/sheet1.xml");
  let central = -1;
  for (let i = 0; i < output.length - 46 - label.length; i++) {
    if (output.readUInt32LE(i) === 0x02014b50 &&
        output.subarray(i + 46, i + 46 + label.length).equals(label)) {
      central = i; break;
    }
  }
  assert.ok(central >= 0, "ZIP should contain a canonical sheet");
  const local = output.readUInt32LE(central + 42);
  const start = local + 30 + output.readUInt16LE(local + 26) + output.readUInt16LE(local + 28);
  const length = output.readUInt32LE(central + 24);
  const sheet = output.subarray(start, start + length);
  const position = sheet.indexOf(before);
  assert.ok(position >= 0, "expected worksheet tag not found: " + before);
  sheet.write(after, position, "utf8");
  const checksum = crc32(sheet);
  output.writeUInt32LE(checksum, local + 14);
  output.writeUInt32LE(checksum, central + 16);
  return output;
}

test("Stage 136: canonical XLSX still preserves bilingual analyte and exact four-decimal tariffs", () => {
  const rows = parseCsvReviewFile(xlsxReviewToCsv(catalogReviewXlsx(csv)));
  assert.equal(rows.length, 2);
  assert.equal(rows[0].data.nameAr, "هرمون");
  assert.equal(rows[0].data.nameEn, "Free, T4");
  assert.equal(rows[1].data.unitPrice, "123.4500");
});

test("Stage 136: well-checksummed, unrecognized nonempty cell is rejected rather than silently dropped", () => {
  // Pre-fix reader discarded <z r="E2">, silently losing the component name
  // while keeping a correctly checksummed, otherwise parseable XLSX document.
  const malicious = replaceWorksheetTag(catalogReviewXlsx(csv),
    '<c r="E2"', '<z r="E2"');
  assert.throws(() => xlsxReviewToCsv(malicious),
    (error: unknown) => error instanceof XlsxStagingError &&
      error.reason === "xlsx_unparsed_sheet_cell");
});

test("Stage 136: unrecognized text elements cannot erase Arabic/clinical label silently", () => {
  const malicious = replaceWorksheetTag(catalogReviewXlsx(csv),
    '<t xml:space="preserve">', '<q xml:space="preserve">');
  assert.throws(() => xlsxReviewToCsv(malicious),
    (error: unknown) => error instanceof XlsxStagingError &&
      error.reason === "xlsx_unparsed_cell_text");
});

test("Stage 136: unsupported row XML and invalid sheetData are fail-closed", () => {
  const book = catalogReviewXlsx(csv);
  const missingRow = replaceWorksheetTag(book, '<row r="2">', '<rob r="2">');
  assert.throws(() => xlsxReviewToCsv(missingRow), XlsxStagingError);
  const hiddenSection = replaceWorksheetTag(book, '<sheetData>', '<sheerData>');
  assert.throws(() => xlsxReviewToCsv(hiddenSection),
    (error: unknown) => error instanceof XlsxStagingError &&
      error.reason === "xlsx_invalid_sheet_data");
});

test("Stage 136: staging remains a DRAFT-only audited review with unchanged clinical and pricing approvals", () => {
  const route = readFileSync("src/app/api/catalog/imports/csv/route.ts", "utf8");
  assert.match(route, /sourceType: "CSV_REVIEW"/);
  assert.match(route, /status: "DRAFT", validatedAt: null/);
  assert.match(route, /pricing\.manage/);
  assert.match(route, /catalog\.reference_ranges\.manage/);
  assert.match(route, /resolveClinicalImportScope/);
  assert.doesNotMatch(route, /tx\.(?:labTest|testComponent|priceListItem|referenceInterval)\.(?:create|update)/);
  const commit = readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts", "utf8");
  const revalidate = readFileSync("src/app/api/catalog/imports/[id]/revalidate/route.ts", "utf8");
  assert.match(commit, /sourceType === "CSV_REVIEW"/);
  assert.match(revalidate, /sourceType === "CSV_REVIEW"/);
});
