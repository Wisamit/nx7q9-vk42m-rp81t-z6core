import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {
  parseStaffReportHandover,reportHandoverFingerprint,
  reportSnapshotPatientNumber,isStaffHandoverEvent,
} from "../src/lib/report-handover.ts";

const id=randomUUID(),version=randomUUID();
const valid={
  handoverRequestId:id,patientNumber:" FL-PT-0123 ",
  verificationMethod:"PHOTO_ID_AND_PATIENT_NUMBER",
  attestedInPerson:true,
};
test("Stage 114: only explicit, in-person staff attestation for patient handover is accepted",()=>{
  const x=parseStaffReportHandover(valid);
  assert.equal(x.ok,true);
  if(!x.ok)throw Error("valid attestation failed");
  assert.equal(x.value.patientNumber,"FL-PT-0123");
  for(const patch of [
    {handoverRequestId:"foo"},{handoverRequestId:1},
    {patientNumber:""},{patientNumber:" BAD\nVALUE"},
    {patientNumber:"x".repeat(51)},
    {verificationMethod:"UNVERIFIED"},
    {attestedInPerson:false},{attestedInPerson:"true"},
    {recipientRelation:"REPRESENTATIVE"},{evidenceDocumentNumber:"1234"},
  ]){
    const mutated={...valid,...patch};
    assert.equal(parseStaffReportHandover(mutated).ok,false,JSON.stringify(patch));
  }
  assert.equal(parseStaffReportHandover(null).ok,false);
  assert.equal(parseStaffReportHandover([]).ok,false);
});
test("Stage 114: historical report identity is immutable and replay fingerprint ties payload & version",()=>{
  const snap={patient:{patientNumber:" FL-PT-0123 ",fullNameEn:"Synthetic Original"}};
  assert.equal(reportSnapshotPatientNumber(snap),"FL-PT-0123");
  assert.equal(reportSnapshotPatientNumber({patient:{patientNumber:22}}),null);
  assert.equal(reportSnapshotPatientNumber(null),null);
  assert.equal(reportSnapshotPatientNumber({}),null);
  const x=parseStaffReportHandover(valid);
  assert.equal(x.ok,true);
  if(!x.ok)throw Error("unreachable");
  const y=reportHandoverFingerprint(version,x.value);
  assert.match(y,/^[0-9a-f]{64}$/);
  assert.equal(y,reportHandoverFingerprint(version,x.value));
  assert.notEqual(y,reportHandoverFingerprint(randomUUID(),x.value));
  assert.notEqual(y,reportHandoverFingerprint(version,{
    ...x.value,verificationMethod:"TWO_PATIENT_IDENTIFIERS",
  }));
  assert.notEqual(y,reportHandoverFingerprint(version,{
    ...x.value,patientNumber:"DIFFERENT",
  }));
  assert.equal(isStaffHandoverEvent({evidenceType:"STAFF_ATTESTED_IN_PERSON_HANDOVER_V1"}),true);
  assert.equal(isStaffHandoverEvent({evidenceType:"BROWSER_PRINT_REQUESTED"}),false);
});
test("Stage 114: authenticated, tenant-scoped and current-version-locked API with safe status & audit",()=>{
  const route=readFileSync("src/app/api/reports/[versionId]/handover/route.ts","utf8");
  assert.match(route,/requirePermission\("reports.deliver"\)/);
  assert.match(route,/organizationId=session.user.organizationId/);
  assert.match(route,/canAccessBranch\(session,orderingBranchId\)/);
  assert.match(route,/session.activeBranchId!==orderingBranchId/);
  assert.match(route,/reportSnapshotPatientNumber\(version.contentSnapshot\)/);
  assert.match(route,/version.version!==version.report.currentVersion/);
  assert.match(route,/version.status!=="FINAL" && version.status!=="AMENDED"/);
  const lock=route.indexOf("FOR UPDATE");
  const create=route.indexOf("tx.reportDeliveryEvent.create");
  assert.ok(lock>=0 && create>lock);
  assert.match(route,/currentVersion!==version.version/);
  assert.match(route,/reportSnapshotPatientNumber\(stillCurrent.contentSnapshot\)/);
  assert.match(route,/tx.reportDeliveryEvent.findUnique/);
  assert.match(route,/handoverRequestId:input.handoverRequestId/);
  assert.match(route,/code==="P2002"/);
  assert.match(route,/event && sameEvent\(event\)/);
  assert.match(route,/status:"RECORDED"/);
  assert.match(route,/channel:"OTHER"/);
  assert.match(route,/independentPatientAcknowledgement:false/);
  assert.match(route,/physicalDeliveryIndependentlyVerified:false/);
  assert.match(route,/REPORT_IN_PERSON_HANDOVER_STAFF_ATTESTED/);
  assert.doesNotMatch(route,/recipient:input.patientNumber/);
  assert.doesNotMatch(route,/status:"DELIVERED"/);
  assert.doesNotMatch(route,/documentNumber|photoIdNumber|ssn|nationalId/i);
});
test("Stage 114: report UI and history distinguish staff attestation from independent receipt",()=>{
  const page=readFileSync("src/app/reports/[orderId]/page.tsx","utf8");
  const ui=readFileSync("src/components/staff-report-handover.tsx","utf8");
  assert.match(page,/permissions.has\("reports.deliver"\) && latest.version===report.currentVersion/);
  assert.match(page,/StaffReportHandover reportVersionId=\{latest.id\}/);
  assert.match(page,/isStaffHandoverEvent\(event.details\)/);
  assert.match(ui,/StaffReportHandover/);
  assert.match(ui,/attestedInPerson:true/);
  assert.match(ui,/identity check/i);
  assert.match(ui,/independently verified proof of receipt/i);
  assert.ok(ui.includes("requestId.current?.payload!==payload"));
  assert.match(ui,/crypto.randomUUID\(\)/);
  assert.match(ui,/router.refresh\(\)/);
});
