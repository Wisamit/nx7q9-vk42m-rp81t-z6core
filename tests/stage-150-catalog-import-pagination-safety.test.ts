import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requestedCatalogImportPage, catalogImportPageBounds,
  catalogImportVisibilityWhere, CATALOG_IMPORT_PAGE_SIZE } from "../src/lib/catalog-import-pagination.ts";

test("Import paging clamps invalid, hostile and out-of-range navigation without overflow", () => {
  for (const raw of [undefined, "", "0", "-1", "01", "1e9", "NaN", "3.2",
    "1234567890", "Infinity", "1?x=2"])
    assert.equal(requestedCatalogImportPage(raw), 1, String(raw));
  assert.equal(requestedCatalogImportPage("12"), 12);
  assert.equal(CATALOG_IMPORT_PAGE_SIZE, 10);
  assert.deepEqual(catalogImportPageBounds(999, 24), {
    page: 3, totalPages: 3, skip: 20, take: 10,
  });
  assert.deepEqual(catalogImportPageBounds(3, 0), {
    page: 1, totalPages: 1, skip: 0, take: 10,
  });
  assert.deepEqual(catalogImportPageBounds(2, 10), {
    page: 1, totalPages: 1, skip: 0, take: 10,
  });
  assert.throws(() => catalogImportPageBounds(1, -1), /catalog_import_invalid_total/);
  assert.throws(() => catalogImportPageBounds(1, Number.NaN), /catalog_import_invalid_total/);
});

test("Count/list predicate remains author-private and price/range scoped within the same tenant", () => {
  const org = "org", actor = "actor";
  const normal = catalogImportVisibilityWhere({
    organizationId: org, authorId: actor, canManage: true,
    canReviewRanges: false, canManagePricing: false,
  });
  assert.equal(normal.organizationId, org);
  assert.deepEqual(normal.AND, [
    { OR: [
      { sourceType: { not: "CSV_REVIEW" } },
      { rows: { none: { entityType: "REFERENCE_INTERVAL" } } },
    ] },
    { OR: [
      { sourceType: { notIn: ["CSV_REVIEW", "CONFIG_BUNDLE_REVIEW"] } },
      { createdByUserId: actor },
    ] },
  ]);
  assert.deepEqual(normal.OR, [
    { AND: [
      { rows: { none: { entityType: "PRICE_LIST_ITEM" } } },
      { rows: { none: { entityType: "PRICE_LIST" } } },
      { rows: { none: { entityType: "PRICE_LIST_PACKAGE_ITEM" } } },
    ] },
  ]);
  const privileged = catalogImportVisibilityWhere({
    organizationId: org, authorId: actor, canManage: true,
    canReviewRanges: true, canManagePricing: true,
  });
  assert.ok(JSON.stringify(privileged).includes('"createdByUserId":"actor"'));
  assert.deepEqual(catalogImportVisibilityWhere({
    organizationId: org, authorId: actor, canManage: false,
    canReviewRanges: true, canManagePricing: true,
  }), { id: "00000000-0000-0000-0000-000000000000" });
});

test("Catalog UI paginates only the authorized count with stable tie-break and bilingual links", () => {
  const page = readFileSync("src/app/catalog/page.tsx", "utf8");
  const list = readFileSync("src/components/legacy-import-batches.tsx", "utf8");
  for (const keyword of [
    "searchParams: Promise<{ importPage?: string }>",
    "catalogImportVisibilityWhere({",
    "tx.catalogImportBatch.count({ where: importWhere })",
    "tx.catalogImportBatch.findMany({",
    "where: importWhere",
    'orderBy: [{ createdAt: "desc" }, { id: "desc" }]',
    'isolationLevel: "RepeatableRead"',
    "skip: bounds.skip, take: bounds.take",
    "totalVisible={importListing.total}",
  ]) assert.ok(page.includes(keyword), keyword);
  for (const keyword of ["id=\"catalog-import-batches\"", "totalVisible",
    "page>1", "page<totalPages", "importPage=", "الصفحة", "التالي", "السابق"])
    assert.ok(list.includes(keyword), keyword);
  assert.ok(!page.includes("take: 10 }),"));
});
