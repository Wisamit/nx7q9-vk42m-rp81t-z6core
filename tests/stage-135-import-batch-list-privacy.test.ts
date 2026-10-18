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
  const policy = readFileSync("src/lib/catalog-import-pagination.ts", "utf8");
  assert.ok(page.includes("catalogImportVisibilityWhere({"));
  assert.ok(page.includes("tx.catalogImportBatch.count({ where: importWhere })"));
  assert.ok(page.includes("tx.catalogImportBatch.findMany({"));
  assert.ok(page.includes("where: importWhere,"));
  assert.ok(page.includes('isolationLevel: "RepeatableRead"'));
  assert.ok(policy.includes("privateSpreadsheetBatchScope(input.authorId)"));
  assert.ok(policy.includes('rows: { none: { entityType: "REFERENCE_INTERVAL" } }'));
  assert.ok(policy.includes('rows: { none: { entityType: "PRICE_LIST_PACKAGE_ITEM" } }'));
  const detail = readFileSync("src/app/catalog/imports/[id]/page.tsx", "utf8");
  assert.match(detail, /batch\.sourceType === "CSV_REVIEW"/);
  assert.match(detail, /batch\.createdByUserId !== session\.user\.id/);
  const ledger = readFileSync("src/app/api/catalog/imports/reconciliation-ledger/route.ts", "utf8");
  assert.match(ledger, /sourceType:\{notIn:\["CSV_REVIEW","CONFIG_BUNDLE_REVIEW"\]\}/);
});
