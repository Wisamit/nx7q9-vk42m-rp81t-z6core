import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseCatalogBundleForReview } from "../src/lib/catalog-bundle-review.ts";
import { parseCompositeBundleRow, sameCompositeMembership } from "../src/lib/catalog-composite-bundle.ts";

const org = "11111111-1111-4111-8111-111111111111";
const tid = "22222222-2222-4222-8222-222222222222";
const pid = "33333333-3333-4333-8333-333333333333";
const kid = "44444444-4444-4444-8444-444444444444";
const lid = "55555555-5555-4555-8555-555555555555";
const priceId = "66666666-6666-4666-8666-666666666666";
const member = { testId: tid, test: { code: "HB" }, displayOrder: 1, required: true };
const panel = { id: pid, code: "PANEL_HB", nameEn: "Panel", status: "ACTIVE", items: [member] };
const pack = { id: kid, code: "PACKAGE_HB", nameEn: "Package", status: "ACTIVE",
  items: [{ testId: tid, test: { code: "HB" }, displayOrder: 1 }] };
const price = { id: priceId, priceListId: lid, packageId: kid,
  unitPrice: "123.4500", effectiveFrom: "2026-10-13T00:00:00.000Z",
  effectiveTo: null, status: "ACTIVE", package: { code: "PACKAGE_HB" },
  priceList: { code: "PRICE_PUBLIC", scopeType: "ORGANIZATION",
    branchId: null, currency: "EGP" } };
const bundle = (groups: unknown[]) => ({
  format: "family-lab-catalog-bundle", schemaVersion: 1,
  organizationId: org, exportedAt: "2026-10-13T00:00:00.000Z",
  consistency: "transactional-consistent-read", groups,
});
const group = (entityType: string, records: unknown[]) => ({ entityType, records });

test("Stage 117 nine-class source parses complete memberships and exact tariff strings", () => {
  const rows = parseCatalogBundleForReview(bundle([
    group("TEST", []), group("COMPONENT", []), group("UNIT", []),
    group("PANEL", [panel]), group("PACKAGE", [pack]), group("REFERENCE_INTERVAL", []),
    group("PRICE_LIST", []), group("PRICE_LIST_ITEM", []),
    group("PRICE_LIST_PACKAGE_ITEM", [price]),
  ]), org, { pricing: true, ranges: true });
  assert.deepEqual(rows.counts, { PANEL: 1, PACKAGE: 1, PRICE_LIST_PACKAGE_ITEM: 1 });
  assert.deepEqual(rows.ids.memberTests, [tid, tid]);
  assert.deepEqual(rows.ids.pricedPackages, [kid]);
  assert.deepEqual(rows.ids.compositePriceLists, [lid]);
  assert.equal(rows.rows[2].normalized.unitPrice, "123.4500");
  assert.equal(rows.rows[0].normalized.items instanceof Array, true);
});

test("Stage 117 composite parser refuses missing/duplicate/invalid memberships", () => {
  assert.throws(() => parseCompositeBundleRow("PANEL", { ...panel, items: [] }),
    /bundle_composite_incomplete_membership/);
  assert.throws(() => parseCompositeBundleRow("PANEL", {
    ...panel, items: [member, { ...member }],
  }), /bundle_composite_duplicate_member/);
  assert.throws(() => parseCompositeBundleRow("PANEL", {
    ...panel, items: [{ ...member, required: "yes" }],
  }), /bundle_composite_invalid_member/);
  assert.throws(() => parseCompositeBundleRow("PACKAGE", {
    ...pack, items: [{ ...pack.items[0], test: { code: "" } }],
  }), /bundle_composite_invalid_identity/);
  assert.equal(sameCompositeMembership(
    [{ testId: tid, testCode: "HB", displayOrder: 1, required: true }],
    [{ testId: tid, testCode: "HB", displayOrder: 2, required: true }], "PANEL"), false);
  assert.equal(sameCompositeMembership(
    [{ testId: tid, testCode: "HB", displayOrder: 1 }],
    [], "PACKAGE"), false);
});

test("Stage 117 composite price admission fails closed for private scopes and bad amounts", () => {
  assert.throws(() => parseCompositeBundleRow("PRICE_LIST_PACKAGE_ITEM", {
    ...price, priceList: { ...price.priceList, scopeType: "CLIENT" },
  }), /bundle_composite_private_price_scope/);
  assert.throws(() => parseCompositeBundleRow("PRICE_LIST_PACKAGE_ITEM", {
    ...price, unitPrice: "123.45678",
  }), /bundle_composite_invalid_decimal_price/);
  assert.throws(() => parseCompositeBundleRow("PRICE_LIST_PACKAGE_ITEM", {
    ...price, effectiveTo: "2025-01-01T00:00:00Z",
  }), /bundle_composite_invalid_effective_window/);
  assert.throws(() => parseCatalogBundleForReview(bundle([
    group("PRICE_LIST_PACKAGE_ITEM", [price]),
  ]), org, { pricing: false, ranges: true }), /pricing_manage_required/);
  assert.throws(() => parseCatalogBundleForReview(bundle([
    group("PANEL", [panel]),
  ]), "77777777-7777-4777-8777-777777777777",
  { pricing: true, ranges: true }), /bundle_foreign_organization/);
});

test("Stage 117 never routes review batches to live commit; checks membership/price scope", () => {
  const route = readFileSync("src/app/api/catalog/imports/bundle/route.ts", "utf8");
  const commit = readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts", "utf8");
  const page = readFileSync("src/app/catalog/imports/[id]/page.tsx", "utf8");
  const index = readFileSync("src/app/catalog/page.tsx", "utf8");
  assert.match(route, /sameCompositeMembership/);
  assert.match(route, /items:\s*\{\s*some: \{ test: testWhere \}, every: \{ test: testWhere \}/);
  assert.match(route, /sourceId: null, referrerId: null/);
  assert.match(route, /new Prisma.Decimal\(n.unitPrice as string\)\.equals/);
  assert.match(route, /bundle_import_permission_changed/);
  assert.match(route, /sourceType: BUNDLE_REVIEW_SOURCE/);
  assert.match(route, /reviewOnly: true/);
  assert.match(commit, /sourceType === "CONFIG_BUNDLE_REVIEW"/);
  assert.match(page, /candidate.entityType === "PRICE_LIST_PACKAGE_ITEM"/);
  assert.match(index, /entityType: "PRICE_LIST_PACKAGE_ITEM"/);
});
