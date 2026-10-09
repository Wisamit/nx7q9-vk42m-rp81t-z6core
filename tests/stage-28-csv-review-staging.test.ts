import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CsvStagingError, parseCsvReviewFile, CSV_STAGE_TEMPLATE_HEADERS,
} from "../src/lib/catalog-review-csv-import.ts";
import { normalizeImportRow, validateImportRow, rowValidationStatus } from "../src/lib/catalog-import.ts";

const header = CSV_STAGE_TEMPLATE_HEADERS.join(",");
const component = 'COMPONENT,old-7,TSH,FT3,"Free, ""T3""",ثلاثي,PGML,NUMERIC,,,,';
const price = 'PRICE_LIST_ITEM,old-8,TSH,,,,,,BRANCH_AED,123.4500,2026-10-09,';

test("CSV staging preserves quoted Arabic, comma, escaped quotation and financial decimal strings", () => {
  const rows = parseCsvReviewFile("\uFEFF" + header + "\r\n" + component + "\r\n" + price + "\r\n");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].entityType, "COMPONENT");
  assert.equal(rows[0].data.nameEn, 'Free, "T3"');
  assert.equal(rows[0].data.nameAr, "ثلاثي");
  assert.equal(rows[0].legacyKey, "old-7");
  assert.equal(rows[1].data.unitPrice, "123.4500");
  assert.equal(rows[1].data.effectiveFrom, "2026-10-09");
  assert.equal(rowValidationStatus(validateImportRow("COMPONENT",normalizeImportRow(rows[0]))), "WARNING");
  assert.equal(rowValidationStatus(validateImportRow("PRICE_LIST_ITEM",normalizeImportRow(rows[1]))), "WARNING");
});
test("CSV parser rejects wrong formats, duplicates, broken quoting, gaps and extra columns", () => {
  const invalid = [
    "exportFormat,schemaVersion,entityType\r\nfamily-lab-catalog-review-csv,1,COMPONENT",
    "entityType,entityType\nCOMPONENT,COMPONENT",
    header + "\n" + component.replace("COMPONENT,", "TEST,"),
    header + "\n" + component.replace('Free, ""T3""', 'Free, "T3"'),
    header + "\n" + component + ",",
    header + "\n" + 'COMPONENT,old,TSH,"unterminated',
    header + "\n" + component.slice(0, -1),
    header + "\r" + component,
  ];
  for (const csv of invalid) assert.throws(() => parseCsvReviewFile(csv), CsvStagingError, csv.slice(0,60));
});
test("CSV import bounds file bytes, rows and fields with no silent identity truncation", () => {
  assert.throws(() => parseCsvReviewFile(header + "\n" + component + "a".repeat(9000)), /csv_field_too_long/);
  assert.throws(() => parseCsvReviewFile(header + "\n" + component.repeat(50000)), /csv_file_too_large/);
  assert.throws(() => parseCsvReviewFile(header + "\n" + price.replace("old-8", "X".repeat(256))), /csv_legacy_key_too_long/);
  assert.throws(() => parseCsvReviewFile(header + "\n" + component + "\0"), /csv_invalid_content/);
});
test("CSV staging requires permissions and remains DRAFT; commit and revalidation both reject CSV_REVIEW", () => {
  const csvRoute=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  const revalidate=readFileSync("src/app/api/catalog/imports/[id]/revalidate/route.ts","utf8");
  const page=readFileSync("src/app/catalog/imports/[id]/page.tsx","utf8");
  assert.match(csvRoute,/requirePermission\("catalog\.manage"\)/);
  assert.match(csvRoute,/permissions\.has\("pricing\.manage"\)/);
  assert.match(csvRoute,/organizationId: session\.user\.organizationId/);
  assert.match(csvRoute,/branch\.status === "ACTIVE"/);
  assert.match(csvRoute,/sourceType: "CSV_REVIEW"/);
  assert.match(csvRoute,/status: "DRAFT"/);
  assert.match(csvRoute,/tx\.catalogImportRow\.createMany/);
  assert.doesNotMatch(csvRoute,/tx\.(?:labTest|testComponent|priceListItem)\.(?:create|update)/);
  for (const guard of [commit, revalidate]) {
    assert.match(guard,/batch\.sourceType === "CSV_REVIEW"/);
    assert.match(guard,/csv_review_is_not_committable/);
  }
  assert.match(page,/batch\.sourceType !== "CSV_REVIEW"/);
});
