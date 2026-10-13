import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {validStepUpAction,validStepUpResource,stepUpPermissions} from "../src/lib/staff-step-up.ts";

const uid=randomUUID(),target=randomUUID(),invoice=randomUUID();
const source=(path:string)=>readFileSync(path,"utf8");

test("Stage 110: high-risk grants have exact action/permission and direction/money bound resources",()=>{
  const rights=[
    ["PATIENT_MERGE","patients.merge"],
    ["RESULT_AMEND","results.amend"],
    ["CREDIT_NOTE_ISSUE","billing.manage"],
  ] as const;
  for(const [action,permission] of rights){
    assert.equal(validStepUpAction(action),true);
    assert.equal(stepUpPermissions[action],permission);
  }
  assert.equal(validStepUpResource("PATIENT_MERGE",uid+":"+target),true);
  assert.equal(validStepUpResource("PATIENT_MERGE",target+":"+uid),true);
  assert.equal(validStepUpResource("PATIENT_MERGE",uid),false);
  assert.equal(validStepUpResource("PATIENT_MERGE",uid+":"+target+":1"),false);
  assert.equal(validStepUpResource("RESULT_AMEND",uid),true);
  assert.equal(validStepUpResource("RESULT_AMEND",uid+":"+target),false);
  assert.equal(validStepUpResource("CREDIT_NOTE_ISSUE",invoice+":450.1250"),true);
  assert.equal(validStepUpResource("CREDIT_NOTE_ISSUE",invoice+":450"),true);
  assert.equal(validStepUpResource("CREDIT_NOTE_ISSUE",invoice+":0.0001"),true);
  for(const resource of [invoice,invoice+":-1",invoice+":12.12345",
    invoice+":1e4",invoice+":1:extra",uid+":"+target])
    assert.equal(validStepUpResource("CREDIT_NOTE_ISSUE",resource),false,resource);
  assert.equal(validStepUpResource("RESULT_RELEASE",uid+":"+target),false);
  assert.equal(validStepUpResource("REFUND_POST",invoice+":450"),false);
  assert.equal(validStepUpAction("PATIENT_MERGE_IMPERSONATE"),false);
});

test("Stage 110: all new mutation endpoints validate fresh one-time grant inside their database transaction",()=>{
  const routes=[
    ["src/app/api/patients/[id]/merge/route.ts",'"PATIENT_MERGE"',"tx.patient.updateMany","sourcePatientId, targetPatientId"],
    ["src/app/api/results/[id]/amend/route.ts",'"RESULT_AMEND"',"tx.laboratoryResult.create","resourceKey: original.id"],
    ["src/app/api/billing/credit-notes/route.ts",'"CREDIT_NOTE_ISSUE"',"tx.invoice.updateMany","invoiceId, amountText"],
  ] as const;
  for(const [path,action,mutation,resource] of routes){
    const route=source(path);
    const tx=route.indexOf("prisma.$transaction");
    const grant=route.indexOf("await consumeStaffStepUp(tx",tx);
    const write=route.indexOf(mutation,grant);
    assert.ok(tx>=0&&grant>tx&&write>grant,path+": proof must be consumed before a mutation");
    assert.ok(route.includes("x-staff-step-up-token"),path);
    assert.ok(route.includes("StaffStepUpError"),path);
    assert.ok(route.includes(action),path);
    assert.ok(route.includes(resource),path);
    assert.ok(route.includes("stepUpGrantId: stepUp.grantId"),path);
    assert.ok(route.includes("stepUpProofMethod: stepUp.proofMethod"),path);
    assert.ok(route.includes("sessionId: session.id")||route.includes("sessionId:session.id"),path);
    assert.ok(route.includes("organizationId: session.user.organizationId")||route.includes("organizationId:session.user.organizationId"),path);
  }
  const merge=source("src/app/api/patients/[id]/merge/route.ts");
  assert.match(merge,/patientMergeEligibility\(source, target\)/);
  assert.ok(merge.indexOf("patientMergeEligibility(source, target)")<merge.indexOf("await consumeStaffStepUp(tx"));
  const amend=source("src/app/api/results/[id]/amend/route.ts");
  assert.match(amend,/SELECT id, status FROM laboratory_results/);
  assert.match(amend,/FOR UPDATE/);
  assert.match(amend,/newer_result_version_already_exists_or_changed/);
  assert.ok(amend.indexOf("FOR UPDATE")<amend.indexOf('action: "RESULT_AMEND"'));
  const credit=source("src/app/api/billing/credit-notes/route.ts");
  assert.match(credit,/creditNoteError\(/);
  assert.match(credit,/taxCreditReversal\(/);
});

test("Stage 110: every sensitive UI requires the correct action and scoped proof",()=>{
  const panel=source("src/components/patient-merge-panel.tsx");
  assert.match(panel,/action="PATIENT_MERGE"/);
  assert.match(panel,/pendingMerge\.source\.id, pendingMerge\.target\.id/);
  assert.match(panel,/activeBranchId/);
  assert.match(panel,/x-staff-step-up-token/);
  const result=source("src/components/result-workflow-actions.tsx");
  assert.match(result,/setStepUpPending\("RESULT_AMEND"\)/);
  assert.match(result,/commitAmendment\(reason,token\)/);
  assert.match(result,/pendingAmendmentReason/);
  const credit=source("src/components/billing-adjustment-modals.tsx");
  assert.match(credit,/action="CREDIT_NOTE_ISSUE"/);
  assert.match(credit,/pendingCredit\.invoiceId, pendingCredit\.amount/);
  assert.match(credit,/x-staff-step-up-token/);
  assert.match(source("src/app/billing/page.tsx"),/branchId: invoice.branchId/);
  assert.match(source("src/app/patients/[id]/page.tsx"),/activeBranchId=\{session.activeBranchId \|\| ""\}/);
});
