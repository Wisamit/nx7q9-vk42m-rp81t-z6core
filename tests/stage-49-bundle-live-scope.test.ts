import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolveClinicalImportScope} from "../src/lib/catalog-clinical-import-scope.ts";

const source=readFileSync("src/app/api/catalog/imports/bundle/route.ts","utf8");

test("Stage 49: tenant lock precedes live grants, scoped master queries and DRAFT staging",()=>{
  const lock=source.indexOf("const organizationLock = await tx.$queryRaw");
  const branchGrant=source.indexOf("const liveBranchGrants = await tx.userBranchScope.findMany");
  const departmentGrant=source.indexOf("const liveDepartmentGrants = await tx.userDepartmentScope.findMany");
  const liveScope=source.indexOf("const liveScope = resolveClinicalImportScope");
  const master=source.indexOf("const [tests, units, containers, components, intervals, lists, prices]");
  const persist=source.indexOf("const created = await tx.catalogImportBatch.create");
  assert.ok(lock>0&&branchGrant>lock&&departmentGrant>lock&&liveScope>departmentGrant);
  assert.ok(master>liveScope&&persist>master);
  assert.match(source,/WHERE id = \$\{scope\.organizationId\}[\s\S]*?FOR UPDATE/);
  assert.match(source,/status: "ACTIVE"/);
  assert.match(source,/bundle_organization_inactive/);
  assert.match(source,/bundle_department_scope_changed/);
  assert.match(source,/bundle_clinical_scope_changed/);
  assert.match(source,/currentBranchIds\.map\(branchId =>/);
  assert.match(source,/clinicalImportTestWhere\(liveScope\)/);
  assert.match(source,/status: "DRAFT", validatedAt: null/);
  assert.match(source,/status: "WARNING"/);
  assert.match(source,/tx\.auditEvent\.create/);
  assert.doesNotMatch(source,/prisma\.(?:labTest|testComponent|unit|referenceInterval|priceList|priceListItem)\.findMany/);
  assert.doesNotMatch(source,/tx\.(?:labTest|testComponent|referenceInterval|priceListItem)\.(?:create|update|upsert)/);
});

test("Stage 49: revocation and off-branch department grants fail closed; no-grant global policy is explicit",()=>{
  const org="org",branch="branch",department="dept";
  const input={
    organizationId:org,activeBranchId:branch,
    activeBranch:{id:branch,organizationId:org,status:"ACTIVE"},
    branchScopes:[{branchId:branch,branch:{status:"ACTIVE"}}],
    departmentScopes:[{departmentId:department,department:{status:"ACTIVE",organizationId:org,branchId:branch}}],
  };
  assert.deepEqual(resolveClinicalImportScope(input)?.departmentIds,[department]);
  assert.equal(resolveClinicalImportScope({...input,branchScopes:[]}),null);
  assert.equal(resolveClinicalImportScope({...input,departmentScopes:[{departmentId:department,department:{status:"INACTIVE",organizationId:org,branchId:branch}}]}),null);
  assert.equal(resolveClinicalImportScope({...input,departmentScopes:[{departmentId:department,department:{status:"ACTIVE",organizationId:org,branchId:"other"}}]}),null);
  assert.deepEqual(resolveClinicalImportScope({...input,departmentScopes:[]})?.departmentIds,[]);
  // A stale restricted browser session must not become unrestricted after revocation.
  assert.match(source,/session\.user\.departmentScopes\.length && !currentDepartmentGrants\.length/);
  assert.match(source,/initiallyGrantedDepartments\.has\(grant\.departmentId\)/);
  assert.match(source,/initiallyGrantedBranches\.has\(id\)/);
});
