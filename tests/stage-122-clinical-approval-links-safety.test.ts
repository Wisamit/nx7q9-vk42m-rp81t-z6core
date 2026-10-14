import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {validateClinicalRuleApprovalReferences} from "../src/lib/clinical-rule-approval-references.ts";
import type {GovernedClinicalRuleType} from "../src/lib/clinical-rule-step-up.ts";

const org="ORGANIZATION_A",branch="BRANCH_A",user="APPROVER_A";
type Fixture={
  sourceActive:boolean;targetActive:boolean;componentActive:boolean;
  sourceType:"NUMERIC"|"TEXT"; methodActive:boolean;
  ruleBranch:string|null; restricted:boolean; activeDepartment:boolean;
  targetComponentActive:boolean; foreignTest:boolean;
};
const baseline:Fixture={
  sourceActive:true,targetActive:true,componentActive:true,sourceType:"NUMERIC",
  methodActive:true,ruleBranch:branch,restricted:false,activeDepartment:true,
  targetComponentActive:true,foreignTest:false,
};
const args=(type:GovernedClinicalRuleType)=>({
  type,id:"RULE",organizationId:org,activeBranchId:branch,
  userId:user,sessionDepartmentIds:[] as string[],
});
function fixture(overrides:Partial<Fixture>={}){
  const f={...baseline,...overrides};
  const testRecord=(id:string)=>({
    id,resultType:"NUMERIC",departmentId:"DEPT_A",
    department:{organizationId:org,status:f.activeDepartment?"ACTIVE":"INACTIVE",
      branch:{organizationId:org,status:"ACTIVE"}},
    components:[{id:"COMP_SOURCE",code:"SOURCE",status:f.componentActive?"ACTIVE":"INACTIVE",
      resultType:f.sourceType},
      {id:"COMP_TARGET",code:"TARGET",status:f.targetComponentActive?"ACTIVE":"INACTIVE",
        resultType:"NUMERIC"}],
  });
  const source={...testRecord("TEST_SOURCE"),resultType:f.sourceType};
  const target=testRecord("TEST_TARGET");
  const refRule={sourceTestId:"TEST_SOURCE",targetTestId:"TEST_TARGET",
    sourceComponentId:"COMP_SOURCE",branchId:f.ruleBranch,operator:"LT",
    numericThreshold:"0.00000001",textThreshold:null};
  const deltaRule={testId:"TEST_SOURCE",componentId:"COMP_SOURCE",
    branchId:f.ruleBranch,methodId:"METHOD",absoluteLimit:"0.00000001",percentLimit:null};
  const simple={testId:"TEST_SOURCE",branchId:f.ruleBranch};
  const db={
    userDepartmentScope:{findMany:async()=>f.restricted?[{departmentId:"DEPT_B",
      department:{organizationId:org,status:"ACTIVE",
        branch:{organizationId:org,status:"ACTIVE"}}}]:[]},
    labTest:{findFirst:async({where}:{where:{id:string;organizationId:string;status:string}})=>{
      if(where.organizationId!==org||where.status!=="ACTIVE"||f.foreignTest)return null;
      if(where.id==="TEST_SOURCE")return f.sourceActive?source:null;
      if(where.id==="TEST_TARGET")return f.targetActive?target:null;
      return null;
    }},
    branch:{findFirst:async({where}:{where:{id:string;organizationId:string;status:string}})=>
      where.id===branch&&where.organizationId===org&&where.status==="ACTIVE"?{id:branch}:null},
    method:{findFirst:async()=>f.methodActive?{id:"METHOD"}:null},
    calculatedResultRule:{findFirst:async()=>({
      testId:"TEST_SOURCE",targetComponentId:"COMP_TARGET",
    })},
    reflexRule:{findFirst:async()=>refRule},
    deltaRule:{findFirst:async()=>deltaRule},
    autoverificationPolicy:{findFirst:async()=>simple},
    validationHoldRule:{findFirst:async()=>simple},
    criticalEscalationPolicy:{findFirst:async()=>simple},
    resultValidationPolicy:{findFirst:async()=>({
      scope:"TEST",testId:"TEST_SOURCE",branchId:f.ruleBranch,departmentId:null,
    })},
    department:{findFirst:async()=>null},
  };
  return db as unknown as Parameters<typeof validateClinicalRuleApprovalReferences>[0];
}
const types:GovernedClinicalRuleType[]=[
  "CALCULATED_RESULT_RULE","REFLEX_RULE","DELTA_RULE","AUTOVERIFICATION_POLICY",
  "VALIDATION_HOLD_RULE","CRITICAL_ESCALATION_POLICY","RESULT_VALIDATION_POLICY",
];
test("Stage 122: all seven draft classes accept only currently valid scoped master links",async()=>{
  for(const type of types){
    assert.deepEqual(await validateClinicalRuleApprovalReferences(fixture(),args(type)),
      {ok:true},type);
    assert.deepEqual(await validateClinicalRuleApprovalReferences(
      fixture({sourceActive:false}),args(type)),
      {ok:false,error:"clinical_rule_test_inactive_or_forbidden"},type);
    assert.deepEqual(await validateClinicalRuleApprovalReferences(
      fixture({activeDepartment:false}),args(type)),
      {ok:false,error:"clinical_rule_test_inactive_or_forbidden"},type);
    assert.deepEqual(await validateClinicalRuleApprovalReferences(
      fixture({foreignTest:true}),args(type)),
      {ok:false,error:"clinical_rule_test_inactive_or_forbidden"},type);
  }
});
test("Stage 122: inactive linked target, component and method fail before approval",async()=>{
  assert.deepEqual(await validateClinicalRuleApprovalReferences(
    fixture({targetActive:false}),args("REFLEX_RULE")),
    {ok:false,error:"clinical_rule_test_inactive_or_forbidden"});
  assert.deepEqual(await validateClinicalRuleApprovalReferences(
    fixture({componentActive:false}),args("REFLEX_RULE")),
    {ok:false,error:"clinical_rule_source_component_inactive_or_mismatched"});
  assert.deepEqual(await validateClinicalRuleApprovalReferences(
    fixture({componentActive:false}),args("DELTA_RULE")),
    {ok:false,error:"clinical_rule_source_component_inactive_or_mismatched"});
  assert.deepEqual(await validateClinicalRuleApprovalReferences(
    fixture({targetComponentActive:false}),args("CALCULATED_RESULT_RULE")),
    {ok:false,error:"clinical_rule_calculated_target_inactive_or_invalid"});
  assert.deepEqual(await validateClinicalRuleApprovalReferences(
    fixture({methodActive:false}),args("DELTA_RULE")),
    {ok:false,error:"clinical_rule_method_inactive_or_forbidden"});
  assert.deepEqual(await validateClinicalRuleApprovalReferences(
    fixture({sourceType:"TEXT"}),args("REFLEX_RULE")),
    {ok:false,error:"clinical_rule_reflex_threshold_type_changed"});
  assert.deepEqual(await validateClinicalRuleApprovalReferences(
    fixture({sourceType:"TEXT"}),args("DELTA_RULE")),
    {ok:false,error:"clinical_rule_delta_numeric_source_required"});
});
test("Stage 122: disabled or off-branch policy and revoked department grant deny activation",async()=>{
  for(const type of types.filter(t=>t!=="CALCULATED_RESULT_RULE")){
    assert.deepEqual(await validateClinicalRuleApprovalReferences(
      fixture({ruleBranch:"BRANCH_B"}),args(type)),
      {ok:false,error:"clinical_rule_branch_inactive_or_forbidden"},type);
  }
  for(const type of types){
    assert.deepEqual(await validateClinicalRuleApprovalReferences(
      fixture({restricted:true}),{...args(type),sessionDepartmentIds:["DEPT_B"]}),
      {ok:false,error:"clinical_rule_test_inactive_or_forbidden"},type);
  }
});
test("Stage 122: approval revalidates links before proof use, supersession and audit",()=>{
  const route=readFileSync("src/app/api/clinical-rules/governance/route.ts","utf8");
  const link=route.indexOf("await validateClinicalRuleApprovalReferences(tx");
  const consume=route.indexOf('action:"CLINICAL_RULE_APPROVE"');
  const predecessor=route.indexOf("for (const predecessorId of plan.predecessorsToClose)");
  assert.ok(link>0&&consume>link&&predecessor>consume);
  assert.match(route,/isolationLevel: "Serializable"/);
  assert.match(route,/approvalReferencesRevalidated: true/);
  assert.match(route,/sessionDepartmentIds: session\.user\.departmentScopes\.map/);
  assert.match(route,/target\.resultType !== "NUMERIC"/);
  assert.match(route,/component\.resultType !== "NUMERIC"/);
  const ui=readFileSync("src/components/clinical-rule-governance-button.tsx","utf8");
  assert.match(ui,/تعذر الاعتماد: أحد الفحوص/);
});
