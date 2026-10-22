import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("test and package price revision writes serialize on the price-list row", () => {
  for (const path of [
    "src/app/api/pricing/items/route.ts",
    "src/app/api/pricing/package-items/route.ts",
  ]) {
    const route = source(path);
    assert.match(route, /SELECT id FROM price_lists WHERE id = .* FOR UPDATE/);
    assert.match(route, /planNextPriceRevision/);
    assert.match(route, /PRICE_REVISION_MUST_START_AFTER_LATEST/);
    assert.match(route, /predecessorCloseAt/);
  }
});

test("price revision writes preserve audit evidence for superseded history", () => {
  const testRoute = source("src/app/api/pricing/items/route.ts");
  const packageRoute = source("src/app/api/pricing/package-items/route.ts");

  assert.match(testRoute, /PRICE_LIST_ITEM_SUPERSEDED/);
  assert.match(testRoute, /supersededByPriceListItemId/);
  assert.match(packageRoute, /PACKAGE_PRICE_SUPERSEDED/);
  assert.match(packageRoute, /supersededByPriceListPackageItemId/);
});

test("branch-scoped price lists cannot be revised outside the actor branch scope", () => {
  for (const path of [
    "src/app/api/pricing/items/route.ts",
    "src/app/api/pricing/package-items/route.ts",
  ]) {
    const route = source(path);
    assert.match(route, /priceList\.branchId/);
    assert.match(route, /session\.user\.branchScopes\.some/);
    assert.match(route, /branch_forbidden/);
  }
});

test("price resolution fails closed on multiple effective revisions", () => {
  const pricing = source("src/lib/pricing.ts");
  const orders = source("src/app/api/orders/route.ts");

  assert.match(pricing, /selected\.items\.length !== 1/);
  assert.match(pricing, /ambiguous_test_price_revision/);
  assert.match(pricing, /selected\.packageItems\.length !== 1/);
  assert.match(pricing, /ambiguous_package_price_revision/);
  assert.match(orders, /error instanceof PricingConfigurationError/);
  assert.match(orders, /status: 409/);
});


test("referrer pricing wiring is present end to end", () => {
  const schema = source("prisma/schema.prisma");
  const migration = source("prisma/migrations/20261008081000_referrer_pricing_scope/migration.sql");
  const pricing = source("src/lib/pricing.ts");
  const orders = source("src/app/api/orders/route.ts");
  const route = source("src/app/api/pricing/price-lists/route.ts");
  const manager = source("src/components/pricing-manager.tsx");

  assert.ok(schema.includes("REFERRER"));
  assert.ok(schema.includes("referrerId"));
  assert.ok(migration.includes("referrer_id"));
  assert.ok(migration.includes("REFERENCES `referrers`"));
  assert.equal(pricing.split('scopeType: "REFERRER" as const').length - 1, 2);
  assert.equal(orders.split("referrerId,").length - 1 >= 3, true);
  assert.ok(route.includes('scopeType === "REFERRER"'));
  assert.ok(route.includes("referrer_not_found"));
  assert.ok(manager.includes('<option value="REFERRER">'));
  assert.ok(manager.includes('name="referrerId"'));
});


test("price-list creation serializes and rejects tied precedence", () => {
  const route = source("src/app/api/pricing/price-lists/route.ts");
  assert.ok(route.includes("SELECT id FROM organizations"));
  assert.ok(route.includes("FOR UPDATE"));
  assert.ok(route.includes("PRICE_LIST_PRECEDENCE_CONFLICT"));
  assert.ok(route.includes("price_list_precedence_conflict"));
  assert.ok(route.includes("effectiveFrom,"));
});

test("price resolution fails closed when top price lists have tied precedence", () => {
  const pricing = source("src/lib/pricing.ts");
  assert.ok(pricing.includes("samePricingPrecedence"));
  assert.ok(pricing.includes("ambiguous_test_price_list"));
  assert.ok(pricing.includes("ambiguous_package_price_list"));
});

test("F2: billing price selection honors as-of immutable PRICE_LIST priority/status overlays", () => {
  const pricing = source("src/lib/pricing.ts");
  const master = source("src/lib/catalog-f2-effective-view.ts");
  assert.match(pricing, /resolveF2EffectiveCatalogViews\(db as Prisma\.TransactionClient,/);
  assert.match(pricing, /projectF2EffectiveCatalogView\("PRICE_LIST",list,overlays\)/);
  assert.match(pricing, /effectiveFrom:list\.effectiveFrom,effectiveTo:list\.effectiveTo/);
  assert.equal(pricing.split("const effectiveLists=await effectivePricedLists(").length - 1,2,
    "test and package quotations must use the effective list consistently");
  assert.match(pricing, /const ranked = effectiveLists[\s\S]*?list\.items\.length > 0/);
  assert.match(pricing, /const ranked = effectiveLists[\s\S]*?list\.packageItems\.length > 0/);
  assert.match(pricing, /\.filter\(list=>list\.status==="ACTIVE"\)/);
  assert.equal(pricing.split('organizationId: input.organizationId,\n      status: "ACTIVE"').length-1,0,
    "a base inactive price list must be eligible for future activation overlay");
  assert.match(master,/effectiveFrom:\{lte:asOf\}/);
  assert.match(master,/state:"RECORDED"/);
});
