import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(p:string)=>readFileSync(p,"utf8");
test("Stage 102: all organization-management routes use live sessions and explicit permissions",()=>{
  for(const type of ["branches","departments","workstations"]){
    const s=read("src/app/api/organization/"+type+"/route.ts");
    assert.match(s,/getCurrentSession\(\)/);
    assert.match(s,/branches\.manage/);
    assert.match(s,/organizationId/);
    assert.match(s,/requestContext\(\)/);
    assert.match(s,/tx\.auditEvent\.create/);
    assert.match(s,/isolationLevel:Prisma\.TransactionIsolationLevel\.Serializable|isolationLevel: Prisma\.TransactionIsolationLevel\.Serializable/);
    assert.doesNotMatch(s,/\.delete\(/,"master data cannot be hard deleted");
  }
});
test("Stage 102: protected branch mutation cannot rewrite codes or retire referenced branches",()=>{
  const s=read("src/app/api/organization/branches/route.ts");
  assert.match(s,/organizationBranchAdmin\(session\)/);
  assert.match(s,/if \(operation !== "hours" && !administrator\)/);
  assert.match(s,/data\.code !== undefined/);
  assert.match(s,/BRANCH_CREATED/);
  assert.match(s,/BRANCH_DETAILS_UPDATED/);
  assert.match(s,/BRANCH_WORKING_HOURS_UPDATED/);
  assert.match(s,/last_active_branch/);
  for(const model of ["labOrder","specimen","invoice","analyzer","equipment","userBranchScope","specimenTransferManifest"]){
    assert.ok(s.includes("tx."+model+".count("),model+" closure blocker missing");
  }
  assert.match(s,/BRANCH_DEACTIVATED/);
});
test("Stage 102: departments and workstations enforce branch tenancy and existing dependencies",()=>{
  const d=read("src/app/api/organization/departments/route.ts");
  const w=read("src/app/api/organization/workstations/route.ts");
  assert.match(d,/organization_admin_required_for_shared_department/);
  assert.match(d,/department_has_active_dependencies/);
  assert.match(d,/department_code_and_scope_immutable/);
  assert.match(w,/department_not_eligible_for_branch/);
  assert.match(w,/OR:\[\{branchId:null\},\{branchId\}\]/);
  assert.match(w,/branch:\{organizationId:org\}/);
  assert.match(w,/workstation_code_and_branch_immutable/);
  assert.match(w,/scope_revoked/);
});
test("Stage 102: weekly-hours validation is per-day, no overlap and no unapproved default",()=>{
  const s=read("src/lib/branch-administration.ts");
  assert.match(s,/BRANCH_HOURS_KEY/);
  assert.match(s,/Object\.keys\(days\)\.length !== 7/);
  assert.match(s,/windows\.length > 4/);
  assert.match(s,/start >= end/);
  assert.match(s,/start\) return null/);
  const ui=read("src/components/organization-structure-manager.tsx");
  assert.match(ui,/الأقسام/);
  assert.match(ui,/محطات العمل/);
  assert.match(ui,/ساعات العمل المحلية/);
  assert.match(ui,/workingHours:hours/);
  assert.match(read("src/components/system-shell.tsx"),/organization\/branches/);
});
