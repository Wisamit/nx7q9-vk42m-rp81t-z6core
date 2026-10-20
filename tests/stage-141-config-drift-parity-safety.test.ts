import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { catalogBundleDrift } from "../src/lib/catalog-bundle-drift.ts";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";

test("Stage 141: drift inspects all ten source groups including scoped CONTAINER metadata", () => {
  const original=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts", "utf8");
  assert.match(original,/readCatalogLiveObservations\(tx,liveScope,branchIds,idsByType\)/);
  const route=original+"\n"+readFileSync("src/lib/catalog-live-observation.ts","utf8");
  assert.equal(catalogExportTypes.size, 10);
  assert.match(route, /const ordered: CatalogExportType\[\] = \[\.\.\.catalogExportTypes\]/);
  assert.match(route, /type === "CONTAINER"/);
  assert.match(route, /tx\.container\.findMany\(\{[\s\S]*?where: \{ organizationId, \.\.\.cursorScope \}/);
  assert.match(route, /tubeColor: true, additive: true, status: true/);
  assert.match(route, /reconciliation_unsupported_source_group/);
  assert.match(route, /reconciliation_live_master_scope_changed/);

  const record={
    id:randomUUID(),code:"EDTA",nameEn:"EDTA tube",nameAr:"أنبوب",
    tubeColor:"Purple",additive:"EDTA",status:"ACTIVE",
    createdAt:"2026-10-15T08:00:00.000Z",updatedAt:"2026-10-15T08:00:00.000Z",
    deactivatedAt:null,
  };
  assert.equal(catalogBundleDrift(record,JSON.parse(JSON.stringify(record))).disposition,"UNCHANGED");
  const changed=catalogBundleDrift(record,{...record,additive:"Citrate",tubeColor:"Blue"});
  assert.equal(changed.disposition,"DRIFTED");
  assert.deepEqual(new Set(changed.changedFields),new Set(["additive","tubeColor"]));
  assert.equal(JSON.stringify(changed).includes("Citrate"),false,"never disclose live master metadata");
});

test("Stage 141: Stage140 scoped nested tariff metadata has exact drift read parity", () => {
  const bundle=readFileSync("src/app/api/catalog/configuration-export/bundle/route.ts","utf8");
  const driftRoute=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  assert.match(driftRoute,/readCatalogLiveObservations\(tx,liveScope,branchIds,idsByType\)/);
  const drift=driftRoute+"\n"+readFileSync("src/lib/catalog-live-observation.ts","utf8");
  const suffix="status: true, sourceId: true, referrerId: true, clientId: true, contractId: true";
  assert.ok(bundle.split(suffix).length>=3,"both source exported tariff items include full scope context");
  assert.ok(drift.split(suffix).length>=3,"both drift item fetches include the same tariff context");
  for(const type of ["PRICE_LIST_ITEM","PRICE_LIST_PACKAGE_ITEM"]){
    assert.match(drift,new RegExp('type === "'+type+'"'));
    assert.match(bundle,new RegExp('type === "'+type+'"'));
  }
  const source={id:randomUUID(),unitPrice:"15.1200",priceList:{
    code:"BR_A",currency:"AED",scopeType:"BRANCH",branchId:randomUUID(),
    status:"ACTIVE",sourceId:null,referrerId:null,clientId:null,contractId:null,
  }};
  assert.equal(catalogBundleDrift(source,JSON.parse(JSON.stringify(source))).disposition,"UNCHANGED");
  assert.deepEqual(catalogBundleDrift(source,{...source,priceList:{
    ...source.priceList,contractId:randomUUID(),
  }}).changedFields,["priceList.contractId"]);
  assert.deepEqual(catalogBundleDrift(source,{...source,priceList:{
    ...source.priceList,status:"INACTIVE",
  }}).changedFields,["priceList.status"]);
});

test("Stage 141: no drift path modifies clinical, financial or catalog masters", () => {
  const route=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  assert.doesNotMatch(route,/tx\.(?:container|priceList|labTest|referenceInterval)\.(?:update|upsert|create|delete)/);
  assert.match(route,/BUNDLE_REVIEW_SOURCE/);
  assert.match(route,/SELECT id FROM organizations/);
  assert.match(route,/FOR UPDATE/);
  assert.match(route,/livePermissions/);
});
