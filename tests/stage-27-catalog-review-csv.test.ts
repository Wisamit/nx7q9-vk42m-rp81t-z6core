import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogReviewCsv, safeSpreadsheetCell } from "../src/lib/catalog-review-csv.ts";

test("CSV keeps Arabic, stable nested fields, date and exact decimal strings", () => {
  const csv = catalogReviewCsv({ entityType: "PRICE_LIST_ITEM", records: [
    { id: "row-A", unitPrice: "123.4500", priceList: { currency: "AED", code: "PRIVATE" },
      test: { code: "TSH" }, nameAr: "فحص, \"هرمون\"", effectiveFrom: "2026-10-09T00:00:00.000Z" },
  ] }, "organization-1", "2026-10-09T12:00:00.000Z");
  assert.ok(csv.startsWith("\uFEFF"));
  assert.match(csv, /"priceList.code"/);
  assert.match(csv, /"priceList.currency"/);
  assert.match(csv, /"test.code"/);
  assert.match(csv, /"123\.4500"/);
  assert.match(csv, /"فحص, ""هرمون"""/);
  assert.match(csv, /"paged-live-not-atomic"/);
  assert.match(csv, /"organization-1"/);
  assert.ok(csv.endsWith("\r\n"));
});
test("CSV prefixes formula payloads, including whitespace/control bypass attempts", () => {
  for (const value of ["=1+1", "+SUM(1,2)", "-cmd|' /C calc'!A0", "@SUM(A1)", "\t=IMPORTXML(\"x\")",
    "\r\n=1+2", "\uFEFF=1+3", "\u200B=1+4", "   =HYPERLINK(\"x\")"]) {
    assert.ok(safeSpreadsheetCell(value).startsWith('"\''), JSON.stringify(value));
  }
  assert.equal(safeSpreadsheetCell("-12.3400"), '"-12.3400"');
  assert.equal(safeSpreadsheetCell("12.3400"), '"12.3400"');
  assert.equal(safeSpreadsheetCell('Normal "quoted" text'), '"Normal ""quoted"" text"');
});
test("CSV fails safely for ambiguous/unsupported schema without dropping clinical data", () => {
  assert.throws(() => catalogReviewCsv({ entityType: "TEST", records: [null] }, "o", "2026-10-09"), /record_not_object/);
  assert.throws(() => catalogReviewCsv({ entityType: "TEST", records: [{ "test.code": "X" }] }, "o", "2026-10-09"), /invalid_field/);
  assert.throws(() => catalogReviewCsv({ entityType: "TEST", records: [{ custom: new Date() }] }, "o", "2026-10-09"), /unsupported_value|record_not_object/);
});
test("existing export authorization, paging and pricing checks stay in force", () => {
  const api = readFileSync("src/app/api/catalog/configuration-export/route.ts", "utf8");
  const ui = readFileSync("src/components/catalog-configuration-export.tsx", "utf8");
  assert.match(api, /permissions\.has\("catalog\.manage"\)/);
  assert.match(api, /permissions\.has\("pricing\.manage"\)/);
  assert.match(api, /organizationId = session\.user\.organizationId/);
  assert.match(api, /take: 251/);
  assert.match(ui, /catalogReviewCsv\(group,/);
  assert.match(ui, /selected\.length !== 1/);
  assert.match(ui, /checkedAtomicCatalogReviewSource/);
  assert.match(ui, /configuration-export\/bundle\?types=/);
  assert.doesNotMatch(ui, /if \(!finished\) throw new Error/);
  assert.doesNotMatch(ui, /exportBundle\(groups/);
  assert.doesNotMatch(ui, /priceListItem\.create|priceListItem\.update/);
});
