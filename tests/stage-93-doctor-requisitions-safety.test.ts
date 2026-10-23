import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  DoctorRequisitionError,doctorRequisitionFingerprint,isUuid,
  matchingRequisitionOrder,parseDoctorRequisition,validRequisitionDecisionReason,
} from "../src/lib/doctor-requisition.ts";
const patientId=randomUUID(),branchId=randomUUID(),clientRequestId=randomUUID(),
  referrerId=randomUUID(),portalAccountId=randomUUID(),testA=randomUUID(),testB=randomUUID();
const input={patientId,branchId,clientRequestId,priority:"ROUTINE",
  testIds:[testA,testB],diagnosis:"Thyroid follow up",clinicalNotes:"Consider previous findings"};
const fail=(input:unknown,code:string)=>assert.throws(()=>parseDoctorRequisition(input),
  (error:unknown)=>error instanceof DoctorRequisitionError && error.code===code);
test("Stage 93: strict patient, branch, tests, urgency and clinical payload validation",()=>{
  const parsed=parseDoctorRequisition(input);
  assert.deepEqual(parsed.testIds,[testA,testB].sort());
  assert.equal(isUuid(clientRequestId),true);assert.equal(isUuid("bad"),false);
  fail({...input,testIds:[]},"invalid_test_selection");
  fail({...input,testIds:[testA,testA]},"invalid_test_selection");
  fail({...input,testIds:Array.from({length:26},()=>randomUUID())},"invalid_test_selection");
  fail({...input,testIds:["wrong"]},"invalid_test_selection");
  fail({...input,priority:"SUPER_STAT"},"invalid_priority");
  fail({...input,patientId:"bad"},"invalid_requisition_identity");
  fail({...input,clientRequestId:"bad"},"invalid_requisition_identity");
  fail({...input,clinicalNotes:"x".repeat(5001)},"invalid_clinical_text");
  fail({...input,diagnosis:"text\u0000"},"invalid_clinical_text");
  fail(null,"invalid_request");
});
test("Stage 93: exact idempotency binds original patient, physician and clinical context",()=>{
  const parsed=parseDoctorRequisition(input);
  const digest=doctorRequisitionFingerprint(parsed,referrerId,portalAccountId);
  assert.match(digest,/^[a-f0-9]{64}$/);
  assert.equal(digest,doctorRequisitionFingerprint({...parsed,testIds:[testB,testA]},referrerId,portalAccountId));
  assert.notEqual(digest,doctorRequisitionFingerprint({...parsed,diagnosis:"other"},referrerId,portalAccountId));
  assert.notEqual(digest,doctorRequisitionFingerprint(parsed,randomUUID(),portalAccountId));
  assert.notEqual(digest,doctorRequisitionFingerprint(parsed,referrerId,randomUUID()));
  assert.equal(validRequisitionDecisionReason("Clinician and staff reviewed"),true);
  assert.equal(validRequisitionDecisionReason("short"),false);
});
test("Stage 93: conversion must match all frozen identifiers and tests",()=>{
  const order={patientId,branchId,referrerId,priority:"ROUTINE",
    testIds:[testA,testB],diagnosis:"Thyroid follow up",clinicalNotes:"Consider previous findings"};
  assert.equal(matchingRequisitionOrder(order,{...order,testIds:[testB,testA]}),true);
  for(const v of [
    {...order,patientId:randomUUID()},{...order,branchId:randomUUID()},
    {...order,referrerId:randomUUID()},{...order,priority:"STAT"},
    {...order,testIds:[testA]},{...order,diagnosis:"changed"},
    {...order,clinicalNotes:"changed"},
  ])assert.equal(matchingRequisitionOrder(order,v),false);
});
test("Stage 93: electronic ordering is not derived from doctor read permissions or billed on submission",()=>{
  const schema=readFileSync("prisma/schema.prisma","utf8");
  const migration=readFileSync("prisma/migrations/20261012200000_doctor_electronic_requisitions/migration.sql","utf8");
  const portal=readFileSync("src/app/api/portal/doctor-requisitions/route.ts","utf8");
  const principal=readFileSync("src/lib/doctor-portal-access.ts","utf8");
  const admin=readFileSync("src/app/api/doctor-portal-access/route.ts","utf8");
  const order=readFileSync("src/app/api/orders/route.ts","utf8");
  const staff=readFileSync("src/app/api/doctor-requisitions/review/route.ts","utf8");
  const page=readFileSync("src/app/portal/page.tsx","utf8");
  const orderForm=readFileSync("src/components/order-create-form.tsx","utf8");
  const staffPage=readFileSync("src/app/doctor-requisitions/page.tsx","utf8");
  assert.match(schema,/model DoctorRequisition \{/);
  assert.match(schema,/model DoctorRequisitionItem \{/);
  assert.match(schema,/canRequestOrders Boolean\s+@default\(false\)/);
  assert.match(migration,/ADD COLUMN `can_request_orders` BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(migration,/UNIQUE INDEX `dr_portal_request_uq`/);
  assert.match(migration,/CONSTRAINT `dr_order_fk`/);
  assert.match(admin,/canRequestOrders:input\.canRequestOrders===true/);
  assert.match(portal,/!hasLiveDoctorPortalReferrer\(session\.portalAccount\)/);
  assert.match(principal,/account\.type==="DOCTOR"/);
  assert.match(principal,/referrer\.organizationId===account\.organizationId/);
  assert.match(principal,/referrer\.status==="ACTIVE"/);
  assert.match(principal,/referrer\.type==="PHYSICIAN"/);
  assert.match(portal,/can_request_orders=TRUE/);
  assert.match(portal,/WHERE organization_id=\$\{account\.organizationId\}/);
  assert.match(portal,/FROM organizations WHERE id=\$\{account\.organizationId\}/);
  assert.match(portal,/SELECT id FROM doctor_requisitions WHERE id=\$\{id\}/);
  assert.match(portal,/isolationLevel:"Serializable"/);
  assert.doesNotMatch(portal,/tx\.labOrder\.create|tx\.invoice\.create/);
  assert.match(order,/matchingRequisitionOrder/);
  assert.match(order,/SELECT id FROM doctor_requisitions/);
  assert.match(order,/status:"FULFILLED",fulfilledOrderId:order\.id/);
  assert.match(order,/DoctorRequisitionConversionConflict/);
  assert.match(staff,/requirePermission\("orders\.create"\)/);
  assert.match(staff,/canAccessBranch\(session,branchId\)/);
  assert.match(page,/canRequestOrders:true/);
  assert.match(orderForm,/doctorRequisitionId: initialDoctorRequisition\?\.id/);
  assert.match(staffPage,/requirePermission\("orders\.view"\)/);
  assert.match(staffPage,/branchId:\{in:branchIds\}/);
});
