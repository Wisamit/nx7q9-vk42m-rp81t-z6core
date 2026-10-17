import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveCatalogReviewStagingActorWhere } from "../src/lib/catalog-review-staging-auth.ts";

const stage=readFileSync("src/app/api/catalog/imports/route.ts","utf8");
const validate=readFileSync("src/app/api/catalog/imports/[id]/revalidate/route.ts","utf8");

test("legacy staging requires live scoped catalog, pricing and range privileges BEFORE batch or source row creation",()=>{
  const tx=stage.indexOf("const result=await prisma.$transaction(async tx=>");
  const lock=stage.indexOf("SELECT id FROM organizations WHERE id=",tx);
  const actor=stage.indexOf("liveCatalogReviewStagingAuthority(tx,",tx);
  const batch=stage.indexOf("tx.catalogImportBatch.create(",tx);
  const rows=stage.indexOf("tx.catalogImportRow.createMany(",tx);
  const audit=stage.indexOf("tx.auditEvent.create(",tx);
  assert.ok(tx>=0&&lock>tx&&actor>lock&&batch>actor&&rows>batch&&audit>rows);
  assert.match(stage,/AND status='ACTIVE' FOR UPDATE/);
  assert.match(stage,/needsPricing:payload\.rows!\.some\(row=>row\.entityType\.startsWith\("PRICE_"\)\)/);
  assert.match(stage,/needsRanges:payload\.rows!\.some\(row=>row\.entityType==="REFERENCE_INTERVAL"\)/);
  assert.match(stage,/sessionDepartmentIds:session\.user\.departmentScopes\.map/);
  assert.match(stage,/sessionBranchIds:session\.user\.branchScopes\.filter/);
  assert.match(stage,/catalog_import_staging_authority_revoked/);
  assert.match(stage,/sourceType:"LEGACY_MDB_EXPORT"/);
  assert.match(stage,/sourceChecksum:checksum/);
  assert.match(stage,/await readLegacyCatalogJson\(request\)/);
  assert.match(stage,/legacyCatalogSourceNameValid/);
  assert.match(stage,/sourceData:row\.data/);
});

test("legacy revalidate re-reads source evidence under lock, current role and owner, BEFORE normalization or writes",()=>{
  const tx=validate.indexOf("const outcome = await prisma.$transaction(async tx");
  const lock=validate.indexOf("SELECT id FROM organizations",tx);
  const batch=validate.indexOf("const batch = await tx.catalogImportBatch.findFirst",tx);
  const authority=validate.indexOf("liveCatalogReviewStagingAuthority(tx,",tx);
  const prepare=validate.indexOf("const prepared = batch.rows.map(",tx);
  const claim=validate.indexOf("const claim = await tx.catalogImportBatch.updateMany",tx);
  const rowWrite=validate.indexOf("await tx.catalogImportRow.updateMany",tx);
  const audit=validate.indexOf('action: "CATALOG_IMPORT_REVALIDATED"',tx);
  assert.ok(tx>=0&&lock>tx&&batch>lock&&authority>batch&&prepare>authority&&
    claim>prepare&&rowWrite>claim&&audit>rowWrite);
  assert.match(validate,/createdByUserId: session\.user\.id/);
  assert.match(validate,/batch\.sourceType === "CSV_REVIEW"/);
  assert.match(validate,/batch\.sourceType === "CONFIG_BUNDLE_REVIEW"/);
  assert.match(validate,/batch\.sourceType !== "LEGACY_MDB_EXPORT"/);
  assert.match(validate,/needsPricing: batch\.rows\.some\(row => row\.entityType\.startsWith\("PRICE_"\)\)/);
  assert.match(validate,/needsRanges: batch\.rows\.some\(row => row\.entityType === "REFERENCE_INTERVAL"\)/);
  assert.match(validate,/row\.status === "IMPORTED"/);
  assert.match(validate,/row\.status === "SKIPPED"/);
  assert.match(validate,/row\.importedEntityId !== null/);
  assert.match(validate,/updatedAt: batch\.updatedAt/);
  assert.match(validate,/updatedAt: item\.row\.updatedAt/);
  assert.match(validate,/status: \{ notIn: \["IMPORTED", "SKIPPED"\] \}, importedEntityId: null/);
  assert.match(validate,/catalog_revalidate_claim_conflict/);
  assert.match(validate,/isolationLevel: "RepeatableRead"/);
  assert.doesNotMatch(validate,/await prisma\.catalogImportBatch\.findFirst/);
  assert.doesNotMatch(validate,/await prisma\.catalogImportRow\.findMany/);
});

test("current live roles may contribute separate clinical and finance review grants",()=>{
  const base={userId:"user",organizationId:"org",activeBranchId:"branch",
    sessionBranchIds:["branch"],sessionDepartmentIds:["dept"],needsClinicalScope:true,
    needsPricing:true,needsRanges:true};
  const p=liveCatalogReviewStagingActorWhere(base);
  assert.deepEqual(p.organization,{status:"ACTIVE"});
  assert.equal(p.status,"ACTIVE");
  assert.equal((p.AND as object[]).length,3);
  for(const permission of ["catalog.manage","pricing.manage","catalog.reference_ranges.manage"])
    assert.ok(JSON.stringify(p.AND).includes(permission));
  assert.equal((liveCatalogReviewStagingActorWhere({...base,
    needsPricing:false,needsRanges:false}).AND as object[]).length,1);
});
