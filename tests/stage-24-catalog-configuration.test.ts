import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  catalogExportNavigation, catalogExportTypes, exportBundle,
} from "../src/lib/catalog-configuration-export.ts";
import {
  normalizeImportRow, validateImportRow, rowValidationStatus,
} from "../src/lib/catalog-import.ts";

test("export entity allowlist and UUID keyset cursor reject unsupported and injected queries", () => {
  assert.deepEqual([...catalogExportTypes], [
    "TEST", "COMPONENT", "UNIT", "REFERENCE_INTERVAL", "PRICE_LIST", "PRICE_LIST_ITEM",
  ]);
  assert.deepEqual(catalogExportNavigation(null), { ok: true, cursor: null });
  const uuid = "7b37e034-799d-4d30-90df-f25d5c060001";
  assert.deepEqual(catalogExportNavigation(uuid.toUpperCase()), { ok: true, cursor: uuid });
  for (const invalid of [
    "1", "all", "7b37e034-799d-4d30-90df-f25d5c060001 OR 1=1",
    "../../../etc/passwd", "null", "00000000000000000000000000000000",
  ]) assert.deepEqual(catalogExportNavigation(invalid), { ok: false });
});

test("configuration bundle preserves group provenance and doesn't imply an atomic backup", () => {
  const date = "2026-10-09T10:00:00.000Z";
  const group = [{ entityType: "PRICE_LIST_ITEM" as const, records: [
    { id: "p", unitPrice: "11.2350", effectiveFrom: date, currency: "AED" },
  ] }];
  const result = exportBundle(group, "ORGANIZATION", date);
  assert.equal(result.consistency, "paged-live-not-atomic");
  assert.equal(result.schemaVersion, 1);
  assert.equal((result.groups[0].records[0] as { unitPrice: string }).unitPrice, "11.2350");
  assert.equal(result.format, "family-lab-catalog-bundle");
});

test("component and price migration rows are staged for review and never auto-approved", () => {
  const component = normalizeImportRow({
    entityType: "COMPONENT", data: {
      testCode: "GLU", code: "FASTING", nameEn: "Fasting Glucose", unitCode: "MGDL",
    },
  });
  assert.equal(component.testCode, "GLU");
  assert.equal(component.code, "FASTING");
  const cIssues = validateImportRow("COMPONENT", component);
  assert.equal(rowValidationStatus(cIssues), "WARNING");
  assert.ok(cIssues.some(i => i.code === "COMPONENT_MAPPING_APPROVAL_REQUIRED"));
  const price = normalizeImportRow({
    entityType: "PRICE_LIST_ITEM", data: {
      priceListCode: "BRANCH_AED", testCode: "GLU", unitPrice: "12.3400",
      effectiveFrom: "2026-10-09", effectiveTo: "2027-01-01",
    },
  });
  assert.equal(price.unitPrice, "12.3400");
  assert.equal(rowValidationStatus(validateImportRow("PRICE_LIST_ITEM", price)), "WARNING");
  assert.ok(validateImportRow("PRICE_LIST_ITEM", price).some(i => i.code === "PRICE_APPROVAL_REQUIRED"));
  for (const invalid of ["-1", "1.12345", "1e4", "NaN", "1,000", "", "1.00001"]) {
    assert.equal(rowValidationStatus(validateImportRow("PRICE_LIST_ITEM", {
      ...price, unitPrice: invalid,
    })), "ERROR", invalid);
  }
  assert.equal(rowValidationStatus(validateImportRow("PRICE_LIST_ITEM", {
    ...price, effectiveTo: "2026-01-01",
  })), "ERROR");
  assert.equal(rowValidationStatus(validateImportRow("COMPONENT", {
    code: "FASTING", testCode: "", nameEn: "",
  })), "ERROR");
});

test("export route requires explicit catalogue and financial permissions and tenant/branch/department query filters", () => {
  const s = readFileSync(new URL("../src/app/api/catalog/configuration-export/route.ts", import.meta.url), "utf8");
  assert.ok(s.includes('permissions.has("catalog.manage")'));
  assert.ok(s.includes('permissions.has("pricing.manage")'));
  assert.ok(s.includes('item.branch.status === "ACTIVE"'));
  assert.ok(s.includes('item.department.status === "ACTIVE"'));
  assert.ok(s.includes('organizationId: session.user.organizationId') === false); // Uses derived orgId.
  assert.ok(s.includes('const organizationId = session.user.organizationId'));
  assert.ok(s.includes('component: { test: testScope }'));
  assert.ok(s.includes('test: testScope'));
  assert.ok(s.includes('priceList: { organizationId, ...genericPriceScope }'));
  assert.ok(s.includes('...genericPriceScope, ...cursorScope'));
  assert.ok(s.includes('...branchScope, ...cursorScope'));\n  assert.ok(s.includes('permissions.has("catalog.reference_ranges.manage")'));
  assert.ok(s.includes('const base = { orderBy: { id: "asc" as const }, take: 251 }'));
  assert.ok(s.includes('hasMore = records.length > 250'));
  assert.ok(s.includes('Cache-Control": "private, no-store"'));
  assert.ok(s.includes('action: "CATALOG_CONFIGURATION_EXPORTED"'));
  assert.ok(!s.includes("tx.labTest.update("));
  assert.ok(!s.includes("tx.priceListItem.update("));
});

test("existing commit path cannot mutate staged-only components or prices", () => {
  const commit = readFileSync(new URL("../src/app/api/catalog/imports/[id]/commit/route.ts", import.meta.url), "utf8");
  assert.ok(commit.includes('["UNIT", "CONTAINER", "TEST", "PANEL"].includes(row.entityType)'));
  assert.ok(commit.includes('["REFERENCE_INTERVAL", "COMPONENT", "PRICE_LIST_ITEM"]'));
  assert.ok(!commit.includes('row.entityType === "COMPONENT"'));
  assert.ok(!commit.includes('row.entityType === "PRICE_LIST_ITEM"'));
  const importRoute = readFileSync(new URL("../src/app/api/catalog/imports/route.ts", import.meta.url), "utf8");
  assert.ok(importRoute.includes("Array.isArray(r.data)"));
});
