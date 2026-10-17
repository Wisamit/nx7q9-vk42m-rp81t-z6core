import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCatalogBundleForReview } from "../src/lib/catalog-bundle-review.ts";
import { validateBundleSourceBoundary } from "../src/lib/catalog-bundle-source-boundary.ts";
import type { CatalogExportType } from "../src/lib/catalog-configuration-export.ts";

const org = "11111111-1111-4111-8111-111111111111";
const id = "22222222-2222-4222-8222-222222222222";
const branch = "33333333-3333-4333-8333-333333333333";
const priceList = {
  code: "STANDARD", scopeType: "BRANCH", branchId: branch, currency: "AED",
  sourceId: null, referrerId: null, clientId: null, contractId: null,
};
const price = {
  id, priceListId: branch, testId: branch, unitPrice: "120.4500",
  effectiveFrom: "2026-10-17T00:00:00.000Z", status: "ACTIVE",
  test: { code: "TEST" }, priceList,
};
function review(entityType: CatalogExportType, record: Record<string, unknown>) {
  return parseCatalogBundleForReview({
    format: "family-lab-catalog-bundle", schemaVersion: 1,
    organizationId: org, exportedAt: "2026-10-17T00:00:00.000Z",
    consistency: "transactional-consistent-read",
    groups: [{ entityType, records: [record] }],
  }, org, { pricing: true, ranges: true });
}

test("Stage 146 generic review still preserves approved branch-scoped exact decimal evidence", () => {
  const parsed = review("PRICE_LIST_ITEM", price);
  assert.equal(parsed.rows[0].normalized.unitPrice, "120.4500");
  assert.equal(parsed.rows[0].original.unitPrice, "120.4500");
  assert.equal(parsed.rows[0].normalized.branchId, branch);
});

test("Stage 146 rejects four private identities in all three tariff input shapes", () => {
  for (const field of ["sourceId", "referrerId", "clientId", "contractId"]) {
    assert.throws(() => review("PRICE_LIST", {
      id, ...priceList, [field]: branch, status: "ACTIVE",
    }), /bundle_private_tariff_link_forbidden/);
    assert.throws(() => review("PRICE_LIST_ITEM", {
      ...price, priceList: { ...priceList, [field]: branch },
    }), /bundle_private_tariff_link_forbidden/);
    const { testId: _testId, test: _test, ...base } = price;
    assert.throws(() => review("PRICE_LIST_PACKAGE_ITEM", {
      ...base, packageId: branch, package: { code: "PACK" },
      priceList: { ...priceList, [field]: branch },
    }), /bundle_private_tariff_link_forbidden/);
  }
});

test("Stage 146 refuses broad/private tariff scope and source-data smuggling", () => {
  assert.throws(() => review("PRICE_LIST_ITEM", {
    ...price, priceList: { ...priceList, scopeType: "CLIENT" },
  }), /bundle_price_scope_requires_separate_governance/);
  assert.throws(() => review("PRICE_LIST", {
    id, ...priceList, scopeType: "ORGANIZATION", branchId: branch,
  }), /bundle_tariff_branch_mismatch/);
  assert.throws(() => review("PRICE_LIST_ITEM", {
    ...price, priceList: { ...priceList, hiddenPatient: "synthetic" },
  }), /bundle_unexpected_source_field/);
  assert.throws(() => review("TEST", {
    id, code: "T", nameEn: "Test", patientSecret: { synthetic: true },
  }), /bundle_unexpected_source_field/);
});

test("Stage 146 bounds all ten v1 export row and nested relation shapes", () => {
  const sample: Array<[CatalogExportType, Record<string, unknown>]> = [
    ["TEST", { id, code: "T", nameEn: "Test", status: "ACTIVE" }],
    ["UNIT", { id, code: "U", nameEn: "Unit", symbol: "u" }],
    ["CONTAINER", { id, code: "C", nameEn: "Container" }],
    ["COMPONENT", { id, code: "H", nameEn: "Hb",
      test: { code: "T" }, unit: { code: "U", symbol: "u" } }],
    ["PANEL", { id, code: "P", nameEn: "Panel",
      items: [{ testId: branch, displayOrder: 1, required: true, test: { code: "T" } }] }],
    ["PACKAGE", { id, code: "K", nameEn: "Pack",
      items: [{ testId: branch, displayOrder: 1, test: { code: "T" } }] }],
    ["REFERENCE_INTERVAL", { id, component: { code: "HB", test: { code: "T" } } }],
    ["PRICE_LIST", { id, ...priceList }],
    ["PRICE_LIST_ITEM", price],
    ["PRICE_LIST_PACKAGE_ITEM", { id, priceListId: branch, packageId: branch,
      unitPrice: "30.0000", effectiveFrom: "2026-10-17T00:00:00.000Z",
      status: "ACTIVE", package: { code: "PKG" }, priceList }],
  ];
  for (const [type, row] of sample) {
    assert.doesNotThrow(() => validateBundleSourceBoundary(type, row), type);
    assert.throws(() => validateBundleSourceBoundary(type, { ...row, opaque: "secret" }),
      /bundle_unexpected_source_field/, type);
  }
  assert.throws(() => validateBundleSourceBoundary("PANEL", {
    ...sample[4][1], items: [{ testId: branch, displayOrder: 1,
      required: true, test: { code: "T", hidden: "secret" } }],
  }), /bundle_unexpected_source_field/);
  assert.throws(() => validateBundleSourceBoundary("REFERENCE_INTERVAL", {
    ...sample[6][1], component: { code: "HB", test: { code: "T", hidden: "secret" } },
  }), /bundle_unexpected_source_field/);
});

test("Stage 146 inbound master and nested price checks are the same as outbound scope", () => {
  const route = readFileSync("src/app/api/catalog/imports/bundle/route.ts", "utf8");
  assert.match(route, /genericCatalogPriceScope\(\[\.\.\.activeBranches\]\)/);
  assert.match(route, /priceList: permittedPriceList, test: testWhere/);
  assert.match(route, /priceList: permittedPriceList,/);
  assert.match(route, /tx\.priceList\.findMany/);
  assert.match(route, /tx\.priceListPackageItem\.findMany/);
  assert.match(route, /sourceType: BUNDLE_REVIEW_SOURCE/);
  assert.match(route, /reviewOnly: true/);
});
