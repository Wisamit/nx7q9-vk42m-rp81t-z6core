import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveCatalogReviewStagingActorWhere } from "../src/lib/catalog-review-staging-auth.ts";
import { clinicalImportTestWhere } from "../src/lib/catalog-clinical-import-scope.ts";

test("paged exports require CURRENT same-tenant ACTIVE actor and role permission for clinical and pricing evidence",()=>{
  const base={
    userId:"user",organizationId:"org",activeBranchId:"branch",
    sessionBranchIds:["branch"],sessionDepartmentIds:["dept"],
    needsPricing:true,needsRanges:true,needsClinicalScope:true,
  };
  const where=liveCatalogReviewStagingActorWhere(base);
  assert.equal(where.status,"ACTIVE");
  assert.deepEqual(where.organization,{status:"ACTIVE"});
  assert.deepEqual((where.AND as object[]).length,3);
  for(const perm of ["catalog.manage","pricing.manage","catalog.reference_ranges.manage"])
    assert.match(JSON.stringify(where.AND),new RegExp('"'+perm.replace(/\./g,"\\.")+'"'));
  const ranges=liveCatalogReviewStagingActorWhere({...base,needsPricing:false});
  assert.equal((ranges.AND as object[]).length,2);
  const publicMasters=liveCatalogReviewStagingActorWhere({...base,needsPricing:false,needsRanges:false});
  assert.equal((publicMasters.AND as object[]).length,1);
});

test("all paged TEST, COMPONENT, REFERENCE_INTERVAL and price exports use the live branch-and-department test predicate",()=>{
  const route=readFileSync("src/app/api/catalog/configuration-export/route.ts","utf8");
  const guard=route.indexOf("const authorized = await liveCatalogReviewStagingAuthority(tx,");
  const lock=route.indexOf("SELECT id FROM organizations");
  const firstRead=route.indexOf("records = await prisma.labTest.findMany(");
  assert.ok(lock>=0&&guard>lock&&firstRead>guard);
  assert.match(route,/AND status = 'ACTIVE' FOR UPDATE/);
  assert.match(route,/isolationLevel: "RepeatableRead"/);
  assert.match(route,/const branchIds = authorized\.branchIds/);
  assert.match(route,/const departmentIds = authorized\.departmentIds/);
  assert.match(route,/const testScope = \{ \.\.\.clinicalImportTestWhere\(\{/);
  assert.match(route,/needsPricing: type\.startsWith\("PRICE_"\)/);
  assert.match(route,/needsRanges: type === "REFERENCE_INTERVAL"/);
  for(const model of ["labTest","testComponent","referenceInterval","priceList",
    "priceListItem","priceListPackageItem","testPanel","commercialPackage"]){
    assert.match(route,new RegExp('prisma\\.'+model+'\\.findMany\\('),model);
  }
  assert.match(route,/where: \{ \.\.\.testScope, \.\.\.cursorScope \}/);
  assert.match(route,/where: \{ test: testScope, \.\.\.cursorScope \}/);
  assert.match(route,/where: \{ component: \{ test: testScope \}, \.\.\.branchScope, \.\.\.cursorScope \}/);
  assert.match(route,/const genericPriceScope = genericCatalogPriceScope\(branchIds\)/);
  assert.match(route,/sourceId: null, clientId: null, contractId: null, referrerId: null/);
  assert.match(route,/CATALOG_CONFIGURATION_EXPORTED/);
  assert.match(route,/consistency: "paged-live-not-atomic"/);
  assert.doesNotMatch(route,/const branchIds = session\.user\.branchScopes/);
});

test("signed transactional bundle rechecks the live actor and all requested dependent permissions under tenant lock",()=>{
  const bundle=readFileSync("src/app/api/catalog/configuration-export/bundle/route.ts","utf8");
  const tx=bundle.indexOf("const outcome = await prisma.$transaction(async tx");
  const lock=bundle.indexOf("SELECT id FROM organizations",tx);
  const live=bundle.indexOf("liveCatalogReviewStagingAuthority(tx,",tx);
  const first=bundle.indexOf("records = await tx.labTest.findMany(");
  assert.ok(tx>=0&&lock>tx&&live>lock&&first>live);
  assert.match(bundle,/needsPricing: requested\.some\(type => type\.startsWith\("PRICE_"\)\)/);
  assert.match(bundle,/needsRanges: requested\.includes\("REFERENCE_INTERVAL"\)/);
  assert.match(bundle,/const branchIds = authorized\.branchIds/);
  assert.match(bundle,/departmentIds: authorized\.departmentIds/);
  assert.match(bundle,/isolationLevel: "RepeatableRead"/);
  assert.match(bundle,/const genericPriceScope = genericCatalogPriceScope\(branchIds\)/);
  assert.match(bundle,/attestCatalogBundle/);
  assert.match(bundle,/CATALOG_CONFIGURATION_ATOMIC_BUNDLE_EXPORTED/);
  assert.match(bundle,/bundle_export_live_scope_or_permission_revoked/);
});

test("active branch membership and scoped departments are always prerequisites to exporting patient-independent catalog definitions",()=>{
  const query=clinicalImportTestWhere({
    organizationId:"org",branchId:"branch-a",departmentIds:["dept-a"],
  });
  assert.deepEqual(query,{
    organizationId:"org",status:"ACTIVE",
    departmentId:{in:["dept-a"]},
    OR:[{departmentId:null},{department:{is:{
      status:"ACTIVE",OR:[{branchId:null},{branchId:"branch-a"}],
    }}}],
  });
  assert.deepEqual(clinicalImportTestWhere({
    organizationId:"org",branchId:"branch-b",departmentIds:[],
  }).OR,[{departmentId:null},{department:{is:{
    status:"ACTIVE",OR:[{branchId:null},{branchId:"branch-b"}],
  }}}]);
});
