import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {clinicalRuleProofResource,governedClinicalRuleTypes,
  validClinicalRuleProofResource} from "../src/lib/clinical-rule-step-up.ts";
import {validStepUpAction,validStepUpResource,stepUpPermissions} from "../src/lib/staff-step-up.ts";
import {evaluateAutoverification} from "../src/lib/autoverification.ts";

const code=(path:string)=>readFileSync(path,"utf8");
test("Stage 120: one-time clinical rule tokens bind type, identity, action and permission",()=>{
  const id=randomUUID(),different=randomUUID();
  for(const type of governedClinicalRuleTypes){
    const resource=clinicalRuleProofResource(type,id);
    assert.equal(resource,type+":"+id);
    assert.ok(resource);
    assert.equal(validStepUpResource("CLINICAL_RULE_APPROVE",resource),true);
    assert.equal(validStepUpResource("CLINICAL_RULE_RETIRE",resource),true);
    assert.equal(validStepUpResource("CLINICAL_RULE_APPROVE",type+":"+different),true);
    assert.equal(validStepUpResource("RESULT_RELEASE",resource),false);
    assert.equal(validClinicalRuleProofResource(resource),true);
  }
  assert.equal(validStepUpAction("CLINICAL_RULE_APPROVE"),true);
  assert.equal(validStepUpAction("CLINICAL_RULE_RETIRE"),true);
  assert.equal(stepUpPermissions.CLINICAL_RULE_APPROVE,"clinical_rules.approve");
  assert.equal(stepUpPermissions.CLINICAL_RULE_RETIRE,"clinical_rules.approve");
  for(const x of ["REFLEX_RULE:not-a-uuid","UNKNOWN:"+id,"REFLEX_RULE:"+id+":EXTRA",
    "reflex_rule:"+id,"REFLEX_RULE:"+id.toUpperCase(),""]){
    assert.equal(validClinicalRuleProofResource(x),false,x);
    assert.equal(validStepUpResource("CLINICAL_RULE_APPROVE",x),false,x);
  }
});
test("Stage 120: both clinical approval and retirement reauthenticate before rule writes",()=>{
  const route=code("src/app/api/clinical-rules/governance/route.ts");
  assert.match(route,/requirePermission\("clinical_rules\.approve"\)/);
  assert.match(route,/clinicalRuleProofResource\(type,id\)/);
  assert.match(route,/clinical_rule_active_branch_required/);
  assert.match(route,/ensureCurrentAuthority\(tx\)/);
  assert.match(route,/permissions:\{some:\{permission:\{code:"clinical_rules\.approve"/);
  assert.match(route,/userSession\.findFirst/);
  assert.match(route,/await consumeStaffStepUp\(tx/);
  assert.match(route,/action:"CLINICAL_RULE_APPROVE"/);
  assert.match(route,/action:"CLINICAL_RULE_RETIRE"/);
  assert.match(route,/sessionId:session\.id/);
  assert.match(route,/resourceKey:proofResource/);
  assert.match(route,/stepUpGrantId:stepUp\.grantId/);
  assert.match(route,/stepUpProofMethod:stepUp\.proofMethod/);
  const approve=route.indexOf('action:"CLINICAL_RULE_APPROVE"');
  const release=route.indexOf('await tx.reflexRule.update(',approve);
  const retire=route.indexOf('action:"CLINICAL_RULE_RETIRE"');
  const retirement=route.indexOf('await tx.reflexRule.update(',retire);
  assert.ok(approve>0&&release>approve&&retire>release&&retirement>retire);
  assert.match(route,/StaffStepUpError/);
});
test("Stage 120: bilingual UI uses actual proof dialog without storing a token",()=>{
  const ui=code("src/components/clinical-rule-governance-button.tsx");
  const page=code("src/app/clinical-rules/page.tsx");
  assert.match(ui,/StaffStepUpDialog/);
  assert.match(ui,/CLINICAL_RULE_APPROVE/);
  assert.match(ui,/CLINICAL_RULE_RETIRE/);
  assert.match(ui,/x-staff-step-up-token/);
  assert.match(ui,/clinicalRuleProofResource/);
  assert.match(ui,/active branch|فرع نشط/);
  assert.match(page,/branchId=\{session\.activeBranchId \|\| ""\}/);
  assert.doesNotMatch(ui,/localStorage|sessionStorage/);
});
test("Stage 120: reflex review is one-winner pending CAS, with audit only after claim",()=>{
  const source=code("src/app/api/results/[id]/reflex/[eventId]/route.ts");
  const claim=source.indexOf("tx.reflexRuleEvent.updateMany");
  const audit=source.indexOf("tx.auditEvent.create",claim);
  assert.ok(claim>0&&audit>claim);
  assert.match(source,/status:"PENDING"/);
  assert.match(source,/claimed\.count!==1/);
  assert.match(source,/reflex_event_changed_since_review/);
  assert.match(source,/reflex_authority_revoked/);
  assert.match(source,/userDepartmentScope\.findMany/);
  assert.match(source,/userBranchScope|branchScopes:/);
  assert.match(source,/organizationId:session\.user\.organizationId/);
  assert.match(source,/private, no-store/);
  assert.doesNotMatch(source,/tx\.reflexRuleEvent\.update\(/);
});
test("Stage 120: existing QC, delta, reflex and critical manual gates remain in autoverification",()=>{
  const base={policy:{
    id:"policy",enabled:true,allowManual:false,allowAnalyzer:true,allowImport:false,
    requireNoCritical:true,requireDeltaWithinLimit:true,requireNoPendingReflex:true,
    requireNoBlockingHolds:true,requireAllFlagsNormal:false,
  },source:"ANALYZER" as const,complete:true,values:[{
    flag:"NORMAL" as const,isAbnormal:false,isCritical:false,
    deltaEvaluation:"WITHIN_LIMIT" as const,
  }],pendingReflexCount:0,blockingHoldCount:0};
  assert.equal(evaluateAutoverification({...base,qcGate:null}).eligible,false);
  const qcGate={status:"PASS" as const,reasons:[]};
  assert.equal(evaluateAutoverification({...base,qcGate}).eligible,true);
  assert.equal(evaluateAutoverification({...base,qcGate,pendingReflexCount:1}).eligible,false);
  assert.equal(evaluateAutoverification({...base,qcGate,blockingHoldCount:1}).eligible,false);
  assert.equal(evaluateAutoverification({...base,qcGate,values:[{
    flag:"CRITICAL_HIGH",isAbnormal:true,isCritical:true,deltaEvaluation:"EXCEEDED",
  }]}).eligible,false);
});
