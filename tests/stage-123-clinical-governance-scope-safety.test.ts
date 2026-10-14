import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {assessClinicalGovernanceScope} from "../src/lib/clinical-rule-governance-scope.ts";
import {validateClinicalRuleApprovalReferences} from "../src/lib/clinical-rule-approval-references.ts";

const ORG="ORG",A="BRANCH_A",B="BRANCH_B",DEPT_A="DEPT_A",DEPT_B="DEPT_B";
type Settings={
  grantBranches:string[];sessionBranches:string[];grantDepartments:string[];
  sessionDepartments:string[];branchBActive:boolean;testDepartmentBranch:string|null;
};
const defaults:Settings={
  grantBranches:[A],sessionBranches:[A],grantDepartments:[],
  sessionDepartments:[],branchBActive:true,testDepartmentBranch:B,
};
function fake(overrides:Partial<Settings>={}){
  const s={...defaults,...overrides};
  const activeBranches=[A,...(s.branchBActive?[B]:[])];
  const departments=[DEPT_A,...(s.branchBActive?[DEPT_B]:[])];
  const db={
    branch:{
      findMany:async()=>activeBranches.map(id=>({id})),
      findFirst:async()=>({id:A}),
    },
    userBranchScope:{
      findMany:async()=>s.grantBranches.map(branchId=>({branchId})),
    },
    department:{findMany:async()=>departments.map(id=>({id}))},
    userDepartmentScope:{findMany:async()=>s.grantDepartments.map(departmentId=>({
      departmentId,department:{organizationId:ORG,status:"ACTIVE",
        branch:{id:departmentId===DEPT_A?A:B,organizationId:ORG,status:"ACTIVE"}},
    }))},
    labTest:{findFirst:async()=>({
      id:"TEST",resultType:"NUMERIC",departmentId:"DEPT_B",
      department:{organizationId:ORG,status:"ACTIVE",
        branch:s.testDepartmentBranch?{id:s.testDepartmentBranch,
          organizationId:ORG,status:"ACTIVE"}:null},
      components:[{id:"TARGET",code:"TARGET",status:"ACTIVE",resultType:"NUMERIC"}],
    })},
    calculatedResultRule:{findFirst:async()=>({testId:"TEST",targetComponentId:"TARGET"})},
  };
  return db as unknown as Parameters<typeof assessClinicalGovernanceScope>[0] &
    Parameters<typeof validateClinicalRuleApprovalReferences>[0];
}
const input=(s:Partial<Settings>={},authBranch:string|null=null)=>{
  const full={...defaults,...s};
  return {organizationId:ORG,userId:"APPROVER",activeBranchId:A,
    authorizationBranchId:authBranch,sessionBranchIds:full.sessionBranches,
    sessionDepartmentIds:full.sessionDepartments};
};
test("Stage 123: branch A reviewer cannot sign organization-wide clinical changes affecting B",async()=>{
  const denied=await assessClinicalGovernanceScope(fake(),input());
  assert.deepEqual(denied,{ok:false,
    error:"clinical_rule_organization_wide_branch_coverage_required"});
  assert.deepEqual(await assessClinicalGovernanceScope(fake(),input({},A)),{
    ok:true,organizationWide:false,activeBranchCount:1,activeDepartmentCount:0,
  });
  assert.deepEqual(await assessClinicalGovernanceScope(fake(),input({},B)),{
    ok:false,error:"clinical_rule_branch_scope_mismatch",
  });
});
test("Stage 123: only active branch coverage from BOTH current DB and session authorizes global rule",async()=>{
  const grant={grantBranches:[A,B],sessionBranches:[A,B]};
  assert.deepEqual(await assessClinicalGovernanceScope(fake(grant),input(grant)),{
    ok:true,organizationWide:true,activeBranchCount:2,activeDepartmentCount:2,
  });
  assert.deepEqual(await assessClinicalGovernanceScope(fake(grant),input({
    ...grant,sessionBranches:[A],
  })),{ok:false,error:"clinical_rule_organization_wide_branch_coverage_required"});
  assert.deepEqual(await assessClinicalGovernanceScope(fake({
    ...grant,grantBranches:[A],
  }),input(grant)),{ok:false,error:"clinical_rule_organization_wide_branch_coverage_required"});
  // An inactive branch does not need active-branch coverage.
  assert.deepEqual(await assessClinicalGovernanceScope(fake({branchBActive:false}),input({
    branchBActive:false,
  })),{ok:true,organizationWide:true,activeBranchCount:1,activeDepartmentCount:1});
});
test("Stage 123: departmental restriction cannot be escalated to organization-wide approval",async()=>{
  const branches={grantBranches:[A,B],sessionBranches:[A,B]};
  const onlyOne={...branches,grantDepartments:[DEPT_A],sessionDepartments:[DEPT_A]};
  assert.deepEqual(await assessClinicalGovernanceScope(fake(onlyOne),input(onlyOne)),{
    ok:false,error:"clinical_rule_organization_wide_department_coverage_required",
  });
  const all={...branches,grantDepartments:[DEPT_A,DEPT_B],
    sessionDepartments:[DEPT_A,DEPT_B]};
  assert.deepEqual(await assessClinicalGovernanceScope(fake(all),input(all)),{
    ok:true,organizationWide:true,activeBranchCount:2,activeDepartmentCount:2,
  });
  assert.deepEqual(await assessClinicalGovernanceScope(fake({...all,
    grantDepartments:[DEPT_A]}),input(all)),{
    ok:false,error:"clinical_rule_organization_wide_department_coverage_required",
  });
  // A newly added scoped grant must not expand an older unrestricted session.
  assert.deepEqual(await assessClinicalGovernanceScope(fake({...branches,
    grantDepartments:[DEPT_A]}),input(branches)),{
    ok:false,error:"clinical_rule_organization_wide_department_coverage_required",
  });
});
test("Stage 123: test owned by branch B cannot be signed as an A-local rule",async()=>{
  const settings={testDepartmentBranch:B};
  const v={type:"CALCULATED_RESULT_RULE" as const,id:"RULE",
    organizationId:ORG,activeBranchId:A,userId:"APPROVER",
    sessionDepartmentIds:[]};
  const denied=await validateClinicalRuleApprovalReferences(fake(settings),{
    ...v,organizationWide:false,
  });
  assert.deepEqual(denied,{ok:false,error:"clinical_rule_test_inactive_or_forbidden"});
  assert.deepEqual(await validateClinicalRuleApprovalReferences(fake(settings),{
    ...v,organizationWide:true,
  }),{ok:true});
  assert.deepEqual(await validateClinicalRuleApprovalReferences(
    fake({testDepartmentBranch:A}),{...v,organizationWide:false}),{ok:true});
});
test("Stage 123: branch coverage guards BOTH approval and retirement before proof consumption",()=>{
  const route=readFileSync("src/app/api/clinical-rules/governance/route.ts","utf8");
  const scope=readFileSync("src/lib/clinical-rule-governance-scope.ts","utf8");
  const ui=readFileSync("src/components/clinical-rule-governance-button.tsx","utf8");
  assert.match(scope,/tx\.branch\.findMany/);
  assert.match(scope,/tx\.userBranchScope\.findMany/);
  assert.match(scope,/originalBranches\.has/);
  assert.match(scope,/activeBranches\.every/);
  assert.match(scope,/tx\.department\.findMany/);
  assert.match(scope,/tx\.userDepartmentScope\.findMany/);
  assert.match(route,/assessClinicalGovernanceScope\(tx/);
  assert.match(route,/sessionBranchIds:session\.user\.branchScopes\.map/);
  assert.match(route,/sessionDepartmentIds:session\.user\.departmentScopes\.map/);
  assert.match(route,/organizationWide: lockedExisting\.authorizationBranchId === null/);
  assert.match(route,/authorizedBranchCount:liveAuthority\.activeBranchCount/);
  assert.match(route,/authorizedDepartmentCount:liveAuthority\.activeDepartmentCount/);
  assert.equal((route.match(/await ensureCurrentAuthority\(tx,lockedExisting\.authorizationBranchId/g)||[]).length,2);
  const approved=route.indexOf('action:"CLINICAL_RULE_APPROVE"');
  const auth=route.indexOf("const liveAuthority=await ensureCurrentAuthority(",route.indexOf('if (action === "APPROVE")'));
  assert.ok(auth>0&&auth<approved);
  assert.match(ui,/اعتماد قاعدة على مستوى المؤسسة/);
  assert.match(ui,/Organization-wide rules require/);
});
