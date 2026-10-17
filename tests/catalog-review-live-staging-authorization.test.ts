import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { liveCatalogReviewStagingActorWhere } from "../src/lib/catalog-review-staging-auth.ts";
import { intersectLiveLegacyClinicalDepartments } from "../src/lib/catalog-legacy-clinical-write-auth.ts";

const base = {
  userId:"user", organizationId:"organization", activeBranchId:"branch-a",
  sessionBranchIds:["branch-a"], sessionDepartmentIds:["department"],
  needsPricing:false, needsRanges:false, needsClinicalScope:true,
};

test("CSV/XLSX staging live actor requires active org, user, tenant roles and catalog.manage", () => {
  assert.deepEqual(liveCatalogReviewStagingActorWhere(base), {
    id:"user", organizationId:"organization", status:"ACTIVE",
    organization:{status:"ACTIVE"},
    AND:[{roles:{some:{role:{
      organizationId:"organization", status:"ACTIVE",
      permissions:{some:{permission:{code:"catalog.manage"}}},
    }}}}],
  });
});

test("mixed clinical+price+range review requires independently active roles for each grant", () => {
  const query = liveCatalogReviewStagingActorWhere({
    ...base, needsPricing:true, needsRanges:true,
  });
  const constraints = query.AND;
  assert.ok(Array.isArray(constraints));
  const codes = constraints.map(item => JSON.stringify(item));
  assert.equal(codes.length,3);
  for(const code of ["catalog.manage","pricing.manage","catalog.reference_ranges.manage"])
    assert.ok(codes.some(x=>x.includes('"'+code+'"')));
  const priceOnly = liveCatalogReviewStagingActorWhere({...base,needsPricing:true});
  assert.equal((priceOnly.AND as unknown[]).length,2);
});

test("active organization lock and fresh authority precede all staged batch and audit writes", () => {
  const s=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  const trx=s.indexOf("const outcome = await prisma.$transaction");
  const tenant=s.indexOf("SELECT id FROM organizations",trx);
  const auth=s.indexOf("const live = await liveCatalogReviewStagingAuthority(tx,",trx);
  const checks=s.indexOf("liveBranchIds = new Set(live.branchIds)",trx);
  const batch=s.indexOf("const created = await tx.catalogImportBatch.create",trx);
  const rows=s.indexOf("await tx.catalogImportRow.createMany",trx);
  const audit=s.indexOf("await tx.auditEvent.create",trx);
  assert.ok(trx>=0&&tenant>trx&&auth>tenant&&checks>auth&&batch>checks&&rows>batch&&audit>rows);
  assert.match(s,/AND status = 'ACTIVE' FOR UPDATE/);
  assert.match(s,/needsPricing: inputs.some\(row => row.entityType.startsWith\("PRICE_"\)\)/);
  assert.match(s,/needsRanges: inputs.some\(row => row.entityType === "REFERENCE_INTERVAL"\)/);
  assert.match(s,/needsClinicalScope: inputs.some\(row => !\["UNIT", "CONTAINER"\]/);
  assert.match(s,/liveBranchIds\.has\(normalized\.branchId\)/);
  assert.match(s,/status: "DRAFT", validatedAt: null/);
  assert.match(s,/sourceType: "CSV_REVIEW"/);
  assert.match(s,/CATALOG_XLSX_REVIEW_STAGED/);
  assert.match(s,/CATALOG_CSV_REVIEW_STAGED/);
  assert.match(s,/status: 201, headers: \{ "Cache-Control": "private, no-store" \}/);
});

test("live stage auth enforces current branch and department scope and no new privileges", () => {
  const s=readFileSync("src/lib/catalog-review-staging-auth.ts","utf8");
  assert.match(s,/oldBranches\.has\(id\)/);
  assert.match(s,/branchIds\.includes\(input\.activeBranchId\)/);
  assert.match(s,/intersectLiveLegacyClinicalDepartments/);
  assert.match(s,/where: \{ userId: input\.userId/);
  assert.match(s,/branch: \{ organizationId: input\.organizationId, status: "ACTIVE" \}/);
  const active={departmentId:"D",department:{status:"ACTIVE",organizationId:"O",branchId:"B"}};
  assert.deepEqual(intersectLiveLegacyClinicalDepartments("O","B",["D"],[active]),["D"]);
  assert.equal(intersectLiveLegacyClinicalDepartments("O","B",["D"],[]),null);
  assert.equal(intersectLiveLegacyClinicalDepartments("O","B",["D"],[
    {...active,departmentId:"E"},
  ]),null);
  assert.deepEqual(intersectLiveLegacyClinicalDepartments("O","B",[],[active]),["D"]);
});

test("CSV and XLSX remain staging only; no clinical or finance activation in review transaction", () => {
  const s=readFileSync("src/app/api/catalog/imports/csv/route.ts","utf8");
  const snippet=s.slice(s.indexOf("const outcome = await prisma.$transaction"));
  assert.doesNotMatch(snippet,/tx\.(?:labTest|referenceInterval|priceList|priceListItem|invoice|result)\.(?:create|update|upsert)/);
  assert.match(snippet,/sourceType: "CSV_REVIEW"/);
  assert.doesNotMatch(snippet,/status: "VALIDATED"/);
  const legacyCommit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(legacyCommit,/latestBatch\.sourceType === "CSV_REVIEW"/);
});
