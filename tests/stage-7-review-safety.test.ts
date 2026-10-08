import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validationSpecimenCustodyError } from "../src/lib/result-validation-custody.ts";

function source(file: string) {
  return readFileSync(new URL(file, import.meta.url), "utf8");
}

test("reference interval previews freeze patient demographics but select currently effective reference policy", () => {
  const page = source("../src/app/worklists/[orderItemId]/page.tsx");
  const interval = page.slice(page.indexOf("resolveReferenceInterval(prisma, {"),page.indexOf("})",page.indexOf("resolveReferenceInterval(prisma, {")) + 2);
  for (const evidence of [
    "referencePatientSex(item.order.patientSexSnapshot)",
    "item.order.patientDobSnapshot",
    "item.order.patientAgeValueSnapshot",
    "item.order.patientAgeUnitSnapshot",
    "item.order.patientAgeRecordedAtSnapshot",
    "ageAsOf: item.order.orderedAt",
    "at: now",
  ]) assert.ok(interval.includes(evidence), "missing frozen interval input: "+evidence);
  assert.ok(!interval.includes("item.order.patient.sexAtBirth"));
  assert.ok(!interval.includes("item.order.patient.dateOfBirth"));
});

test("invalid specimen custody cannot be medically or technically approved", () => {
  const input = {currentBranchId:"BR-1",performingBranchId:"BR-1"};
  assert.equal(validationSpecimenCustodyError({...input,status:"RECEIVED"}),null);
  assert.equal(validationSpecimenCustodyError({...input,status:"IN_PROCESS"}),null);
  for (const status of ["PLANNED","COLLECTED","IN_TRANSIT","QUARANTINED","REJECTED","DISPOSED"]) {
    assert.equal(validationSpecimenCustodyError({...input,status}),"specimen_not_ready_for_validation");
  }
  assert.equal(validationSpecimenCustodyError({status:"RECEIVED",currentBranchId:"BR-2",performingBranchId:"BR-1"}),"specimen_performing_branch_mismatch");
  assert.equal(validationSpecimenCustodyError({status:"RECEIVED",currentBranchId:null,performingBranchId:"BR-1"}),"specimen_performing_branch_mismatch");
});

test("technical review claims same result revision before clinical review record", () => {
  const route=source("../src/app/api/results/[id]/verify/route.ts");
  const tx=route.indexOf("const updated = await prisma.$transaction");
  const lock=route.indexOf("FOR UPDATE",tx);
  const claim=route.indexOf("await tx.laboratoryResult.updateMany",lock);
  const review=route.indexOf("await tx.resultValidationReview.create",claim);
  assert.ok(tx>=0 && lock>tx && claim>lock && review>claim);
  const where=route.slice(claim,review);
  assert.ok(where.includes("updatedAt: result.updatedAt"));
  assert.ok(where.includes('validationStage: { in: ["ENTRY", "TECHNICAL_REVIEW"] }'));
  assert.ok(route.includes('error: "result_state_changed_retry"'));
});

test("both medical approval and return lock source specimen and claim exact state before review event", () => {
  const route=source("../src/app/api/results/[id]/medical-validate/route.ts");
  assert.equal(route.split("const custody = await tx.$queryRaw").length-1,2);
  assert.equal(route.split("await tx.laboratoryResult.updateMany").length-1,2);
  assert.equal(route.split("updatedAt: result.updatedAt").length-1,2);
  assert.equal(route.split('if (claimed.count !== 1) throw new Error("RESULT_STATE_CHANGED")').length-1,2);
  assert.equal(route.split('error: "result_state_changed_retry"').length-1,2);
  assert.ok(route.includes('body.action !== "APPROVE" && body.action !== "RETURN"'));
  const returnTx=route.indexOf("const returned = await prisma.$transaction");
  const returnClaim=route.indexOf("await tx.laboratoryResult.updateMany",returnTx);
  const returnReview=route.indexOf("await tx.resultValidationReview.create",returnClaim);
  assert.ok(returnTx>=0 && returnClaim>returnTx && returnReview>returnClaim);
  const approveTx=route.indexOf("const validated = await prisma.$transaction");
  const approveClaim=route.indexOf("await tx.laboratoryResult.updateMany",approveTx);
  const approveReview=route.indexOf("await tx.resultValidationReview.create",approveClaim);
  assert.ok(approveTx>=0 && approveClaim>approveTx && approveReview>approveClaim);
});

test("manual result changes guard active lineage, specimen custody and exact draft revision before replacing values", () => {
  const route = source("../src/app/api/results/route.ts");
  const tx = route.indexOf("const saved = await prisma.$transaction");
  const lock = route.indexOf("FOR UPDATE", tx);
  const lineage = route.indexOf("const activeLineage = await tx.specimenOrderItem.count",lock);
  const claim = route.indexOf("await tx.laboratoryResult.updateMany",lineage);
  const values = route.indexOf("await tx.laboratoryResultValue.deleteMany",claim);
  assert.ok(tx>=0 && lock>tx && lineage>lock && claim>lineage && values>claim);
  const guarded=route.slice(claim,values);
  assert.ok(guarded.includes("updatedAt: existing.updatedAt"));
  assert.ok(guarded.includes('status: { in: ["DRAFT", "ENTERED"] }'));
  assert.ok(guarded.includes('source: "MANUAL"'));
  assert.ok(guarded.includes('throw new Error("RESULT_STATE_CHANGED")'));
  assert.ok(route.includes('error: "result_concurrently_updated_refresh"'));
});

test("result operator gets bilingual guidance for concurrent saves and reviews", () => {
  const ui = source("../src/components/result-entry-form.tsx");
  assert.ok(ui.includes("result_concurrently_updated_refresh"));
  assert.ok(ui.includes("result_state_changed_retry"));
  assert.ok(ui.includes("تغيرت النتيجة أو حالة العينة"));
});

test("medical RETURN remains available for corrective action after specimen quarantine", () => {
  const route = source("../src/app/api/results/[id]/medical-validate/route.ts");
  const start = route.indexOf("const returned = await prisma.$transaction");
  const end = route.indexOf("const validated = await prisma.$transaction", start);
  const correctiveAction = route.slice(start,end);
  assert.ok(correctiveAction.includes("if (custody.length !== 1)"));
  assert.ok(!correctiveAction.includes("validationSpecimenCustodyError({"));
  const approve = route.slice(end);
  assert.ok(approve.includes("validationSpecimenCustodyError({"));
});
