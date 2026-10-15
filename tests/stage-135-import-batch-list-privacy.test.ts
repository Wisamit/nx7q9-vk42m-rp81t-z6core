import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { privateSpreadsheetBatchScope } from "../src/lib/catalog-import-list-privacy.ts";

test("Stage 135: CSV/XLSX and signed config-bundle batch names are author-only in the catalog index", () => {
  const actor = "11111111-1111-4111-8111-111111111111";
  const scope = privateSpreadsheetBatchScope(actor);
  assert.deepEqual(scope, {
    OR: [
      { sourceType: { notIn: ["CSV_REVIEW", "CONFIG_BUNDLE_REVIEW"] } },
      { createdByUserId: actor },
    ],
  });
  assert.throws(() => privateSpreadsheetBatchScope(""), /catalog_import_author_required/);
  const page = readFileSync("src/app/catalog/page.tsx", "utf8");
  assert.match(page, /prisma\.catalogImportBatch\.findMany\(\{ where:/);
  assert.match(page, /\.\.\.privateSpreadsheetBatchScope\(session\.user\.id\)/);
  assert.ok(page.indexOf("...privateSpreadsheetBatchScope(session.user.id)") <
    page.indexOf('include: { _count: { select: { rows: true } } }'), "author scope belongs in SQL/Prisma WHERE, not post-filter");
  assert.match(page, /rows: \{ none: \{ entityType: "REFERENCE_INTERVAL" \} \}/);
  assert.match(page, /rows: \{ none: \{ entityType: "PRICE_LIST_PACKAGE_ITEM" \} \}/);
  const detail = readFileSync("src/app/catalog/imports/[id]/page.tsx", "utf8");
  assert.match(detail, /batch\.sourceType === "CSV_REVIEW"/);
  assert.match(detail, /batch\.createdByUserId !== session\.user\.id/);
  const ledger = readFileSync("src/app/api/catalog/imports/reconciliation-ledger/route.ts", "utf8");
  assert.match(ledger, /sourceType:\{notIn:\["CSV_REVIEW","CONFIG_BUNDLE_REVIEW"\]\}/);
});
