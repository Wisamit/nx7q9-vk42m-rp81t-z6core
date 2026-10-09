import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  clinicalImportTestWhere, permittedClinicalImportTest, resolveClinicalImportScope,
} from "../src/lib/catalog-clinical-import-scope.ts";

const branchA = "branch-a", branchB = "branch-b", org = "lab-org";
const input = (active: string | null, grants: string[], departments: Array<{id: string; branchId: string | null; status?: string}>) => ({
  organizationId: org, activeBranchId: active,
  activeBranch: active ? {id: active, organizationId: org, status: "ACTIVE"} : null,
  branchScopes: grants.map(branchId => ({branchId, branch: {status: "ACTIVE"}})),
  departmentScopes: departments.map(d => ({departmentId: d.id, department: {
    status: d.status || "ACTIVE", organizationId: org, branchId: d.branchId,
  }})),
});

test("clinical import requires authorized, active, organization-matching branch", () => {
  assert.equal(resolveClinicalImportScope(input(null,[branchA],[])), null);
  assert.equal(resolveClinicalImportScope(input(branchB,[branchA],[])), null);
  const foreign=input(branchA,[branchA],[]);
  foreign.activeBranch!.organizationId = "other-org";
  assert.equal(resolveClinicalImportScope(foreign),null);
  const inactive=input(branchA,[branchA],[]);
  inactive.activeBranch!.status="INACTIVE";
  assert.equal(resolveClinicalImportScope(inactive),null);
  const scope=resolveClinicalImportScope(input(branchA,[branchA,branchB],[]));
  assert.ok(scope);
  assert.equal(scope.branchId,branchA);
  assert.deepEqual(scope.departmentIds,[]);
});

test("department-specific grants do not silently grant foreign/inactive or other branch permissions", () => {
  assert.equal(resolveClinicalImportScope(input(branchA,[branchA],[{id:"dept-b",branchId:branchB}])),null);
  assert.equal(resolveClinicalImportScope(input(branchA,[branchA],[{id:"dept-a",branchId:branchA,status:"INACTIVE"}])),null);
  const scope=resolveClinicalImportScope(input(branchA,[branchA],[
    {id:"dept-a",branchId:branchA},{id:"dept-b",branchId:branchB},{id:"global",branchId:null},
  ]));
  assert.ok(scope);
  assert.deepEqual(scope.departmentIds,["dept-a","global"]);
  assert.equal(permittedClinicalImportTest({departmentId:"dept-a",department:{branchId:branchA,status:"ACTIVE"}},scope),true);
  assert.equal(permittedClinicalImportTest({departmentId:"dept-b",department:{branchId:branchB,status:"ACTIVE"}},scope),false);
  assert.equal(permittedClinicalImportTest({departmentId:"global",department:{branchId:null,status:"ACTIVE"}},scope),true);
  assert.equal(permittedClinicalImportTest({departmentId:null,department:null},scope),false);
  assert.equal(permittedClinicalImportTest({departmentId:"dept-a",department:{branchId:branchA,status:"INACTIVE"}},scope),false);
});

test("scoped Prisma query filters by organization, active test, department and active branch", () => {
  const scope=resolveClinicalImportScope(input(branchA,[branchA],[{id:"dept-a",branchId:branchA}]));
  assert.ok(scope);
  const query=clinicalImportTestWhere(scope);
  assert.equal(query.organizationId,org);
  assert.equal(query.status,"ACTIVE");
  assert.deepEqual(query.departmentId,{in:["dept-a"]});
  assert.ok(query.OR);
  assert.match(JSON.stringify(query),/branch-a/);
});

test("import API and review routing use the same active branch/department limits", () => {
  const range=readFileSync("src/app/api/catalog/imports/[id]/reference-ranges/route.ts","utf8");
  const unit=readFileSync("src/app/api/catalog/imports/[id]/prepare-units/route.ts","utf8");
  const mapping=readFileSync("src/app/api/catalog/imports/[id]/mappings/route.ts","utf8");
  for (const route of [range,unit,mapping]) {
    assert.match(route,/resolveClinicalImportScope\(/);
    assert.match(route,/active_clinical_import_scope_required/);
    assert.match(route,/clinicalImportTestWhere\(scope\)/);
  }
  assert.match(range,/prisma\.labTest\.findMany\(\{ where: clinicalImportTestWhere\(scope\)/);
  assert.match(range,/const currentTest = await tx\.labTest\.findFirst/);
  assert.match(range,/clinical_import_test_scope_changed/);
  assert.ok(range.indexOf("const currentTest = await tx.labTest.findFirst") <
    range.indexOf("const claim = await tx.catalogImportRow.updateMany"));
  assert.match(unit,/scopedTests\.length !== importedIds\.length/);
  assert.match(unit,/legacy_test_department_or_branch_scope_denied/);
  assert.match(mapping,/status: "ACTIVE"/);
});
