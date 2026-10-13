import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {catalogExportTypes,catalogExportNavigation} from "../src/lib/catalog-configuration-export.ts";

const paged=readFileSync("src/app/api/catalog/configuration-export/route.ts","utf8");
const bundle=readFileSync("src/app/api/catalog/configuration-export/bundle/route.ts","utf8");
const ui=readFileSync("src/components/catalog-configuration-export.tsx","utf8");
const kinds=["PANEL","PACKAGE","PRICE_LIST_PACKAGE_ITEM"] as const;

test("Stage 116: all three export kinds registered without an import/mutation side effect",()=>{
  for(const kind of kinds){
    assert.equal(catalogExportTypes.has(kind),true,kind);
    assert.ok(paged.includes('type === "'+kind+'"'),kind);
    assert.ok(bundle.includes('"'+kind+'"'),kind);
    assert.ok(ui.includes('"'+kind+'"'),kind);
  }
  assert.equal(catalogExportTypes.has("PATIENT"),false);
  assert.equal(catalogExportTypes.has("CASHIER_SHIFT"),false);
  assert.deepEqual(catalogExportNavigation("not-an-uuid"),{ok:false});
  assert.match(paged,/export async function GET/);
  assert.match(bundle,/export async function GET/);
  assert.doesNotMatch(paged,/export async function POST/);
  assert.doesNotMatch(bundle,/export async function POST/);
});
test("Stage 116: both export paths reject partially visible panels and packages",()=>{
  for(const route of [paged,bundle]){
    assert.match(route,/const fullyVisibleItems = \{/);
    assert.match(route,/some: \{ test: (?:testScope|compositeTestScope) \}/);
    assert.match(route,/every: \{ test: (?:testScope|compositeTestScope) \}/);
    assert.match(route,/testPanel.findMany/);
    assert.match(route,/commercialPackage.findMany/);
    assert.match(route,/where: \{ organizationId, items: fullyVisibleItems, \.\.\.cursorScope \}/);
    assert.match(route,/test: \{ select: \{ code: true \} \}/);
    assert.match(route,/orderBy: \[\{ displayOrder: "asc" \}, \{ testId: "asc" \}]/);
    assert.match(route,/priceListPackageItem.findMany/);
    assert.match(route,/package: \{ organizationId, items: fullyVisibleItems \}/);
    for(const identifier of ["sourceId","clientId","contractId","referrerId"])
      assert.ok(route.includes(identifier+": null"),"private client/contract pricing must not export: "+identifier);
  }
});
test("Stage 116: financial prices require pricing manage; exact money is never cast to floating point",()=>{
  assert.match(paged,/PRICE_LIST_PACKAGE_ITEM"\)\) && !permissions.has\("pricing.manage"\)/);
  assert.match(bundle,/type.startsWith\("PRICE_"\)/);
  for(const route of [paged,bundle]){
    assert.match(route,/unitPrice: true/);
    assert.match(route,/effectiveFrom: true, effectiveTo: true/);
    assert.match(route,/currency: true, scopeType: true, branchId: true/);
    assert.doesNotMatch(route,/parseFloat\(|Number\(.*unitPrice/);
  }
  assert.match(bundle,/isolationLevel: "RepeatableRead"/);
  assert.match(bundle,/attestCatalogBundle/);
  assert.match(bundle,/BUNDLE_REVIEW_MAX_ROWS/);
  assert.match(bundle,/BUNDLE_REVIEW_MAX_BYTES/);
  assert.match(paged,/take: 251/);
  assert.match(paged,/CATALOG_CONFIGURATION_EXPORTED/);
  assert.match(bundle,/CATALOG_CONFIGURATION_ATOMIC_BUNDLE_EXPORTED/);
});
test("Stage 116: bilingual UI exposes package prices only under financial permission",()=>{
  assert.match(ui,/canExportPricing/);
  assert.match(ui,/PRICE_LIST_PACKAGE_ITEM" as const/);
  assert.match(ui,/PANEL: tr\(/);
  assert.match(ui,/PACKAGE: tr\(/);
  assert.match(ui,/PRICE_LIST_PACKAGE_ITEM: tr\(/);
  assert.match(ui,/transactional-consistent-read/);
});
