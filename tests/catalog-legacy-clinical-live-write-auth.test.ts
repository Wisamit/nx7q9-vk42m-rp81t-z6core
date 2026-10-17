import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  liveLegacyClinicalWriteActorWhere, intersectLiveLegacyClinicalDepartments,
} from "../src/lib/catalog-legacy-clinical-write-auth.ts";

const org = "org", branch = "branch-a", otherBranch = "branch-b";
const row = (departmentId: string, status = "ACTIVE", branchId: string | null = branch,
  tenant = org) => ({departmentId,department:{status,branchId,organizationId:tenant}});

test("legacy clinical mutation always requires active same-tenant clinical role, exact branch and user", () => {
  assert.deepEqual(liveLegacyClinicalWriteActorWhere("actor",org,branch), {
    id:"actor", organizationId:org,status:"ACTIVE",
    organization:{status:"ACTIVE"},
    roles:{some:{role:{
      organizationId:org,status:"ACTIVE",
      permissions:{some:{permission:{code:"catalog.reference_ranges.manage"}}},
    }}},
    branchScopes:{some:{
      branchId:branch,branch:{organizationId:org,status:"ACTIVE"},
    }},
  });
});

test("legacy department scope intersects old and current grants; no revoked permission escalation", () => {
  const pick = (old:string[],current:ReturnType<typeof row>[]) =>
    intersectLiveLegacyClinicalDepartments(org,branch,old,current);
  assert.deepEqual(pick([],[]),[], "unrestricted only if both versions unrestricted");
  assert.deepEqual(pick([], [row("one")]),["one"], "new restriction narrows older broad session");
  assert.equal(pick(["one"], []),null, "revoked former restriction cannot widen to global");
  assert.equal(pick(["one"],[row("two")]),null, "new grant is not inherited by stale session");
  assert.deepEqual(pick(["one","two"],[row("two"),row("one")]),["two","one"]);
  assert.deepEqual(pick(["one","two"],[row("one"),row("one")]),["one"]);
  assert.equal(pick(["one"],[row("one","INACTIVE")]),null);
  assert.equal(pick(["one"],[row("one","ACTIVE",otherBranch)]),null);
  assert.equal(pick(["one"],[row("one","ACTIVE",branch,"foreign")]),null);
  assert.deepEqual(pick(["one"],[row("one","ACTIVE",null)]),["one"]);
  assert.equal(pick([], [row("wrong","ACTIVE",otherBranch)]),null);
  assert.equal(pick([], [row("wrong","ACTIVE",branch,"foreign")]),null);
});

test("all legacy clinical write paths check tenant and live grants before first mutation", () => {
  const files = ["prepare-units","reference-ranges","mappings"];
  for (const name of files) {
    const src = readFileSync("src/app/api/catalog/imports/[id]/"+name+"/route.ts","utf8");
    const scope = src.indexOf("liveLegacyClinicalWriteScope(tx,");
    assert.ok(scope >= 0,name+" must reauthorize current database grants");
    const lock = src.lastIndexOf("SELECT id FROM organizations WHERE id = ",scope);
    assert.ok(lock >= 0 && lock < scope,name+" tenant lock precedes role checks");
    assert.match(src,/AND status = 'ACTIVE' FOR UPDATE/,name);
    assert.match(src,/sessionDepartmentIds: session\.user\.departmentScopes\.map/,name);
    assert.match(src,/sessionBranchIds: session\.user\.branchScopes\.filter/,name);
    if (name==="prepare-units") {
      assert.ok(scope < src.indexOf("tx.unit.create("), "unit creation after auth");
      assert.ok(scope < src.indexOf("tx.labTest.updateMany("), "unit assignment after auth");
      assert.match(src,/clinicalImportTestWhere\(liveScope\)/);
    } else if (name==="reference-ranges") {
      assert.ok(scope < src.indexOf("const claim = await tx.catalogImportRow.updateMany"),
        "clinical range claims after auth");
      assert.match(src,/where: \{ \.\.\.clinicalImportTestWhere\(liveScope\)/);
      assert.match(src,/currentUnit = await tx.unit.findFirst/);
      assert.match(src,/sourceType: "LEGACY_MDB_EXPORT"/);
      assert.match(src,/status: "INACTIVE"/);
      assert.match(src,/approvalStatus: "DRAFT"/);
    } else {
      assert.ok(scope < src.indexOf("tx.catalogImportMapping.upsert("),"mapping upsert after auth");
      assert.match(src,/where: \{ \.\.\.clinicalImportTestWhere\(liveScope\)/);
      assert.match(src,/status: "ACTIVE"/);
      assert.match(src,/legacy_mapping_target_changed/);
    }
  }
});
