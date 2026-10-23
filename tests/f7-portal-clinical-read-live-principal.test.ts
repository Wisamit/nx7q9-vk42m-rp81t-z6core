import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolvePortalBookingActor } from "../src/lib/portal-booking-actor.ts";

const patient=()=>({
  type:"PATIENT",organizationId:"tenant-a",patientId:"patient-a",clientId:null,
  patient:{id:"patient-a",organizationId:"tenant-a",status:"ACTIVE"},client:null,
});
const corporate=()=>({
  type:"CORPORATE",organizationId:"tenant-a",patientId:null,clientId:"client-a",
  patient:null,client:{id:"client-a",organizationId:"tenant-a",status:"ACTIVE"},
});

test("F7 clinical read: patient and corporate link must still be active, matching and within the tenant",()=>{
  assert.deepEqual(resolvePortalBookingActor(patient()),{kind:"PATIENT",patientId:"patient-a"});
  assert.deepEqual(resolvePortalBookingActor(corporate()),{kind:"CORPORATE",clientId:"client-a"});
  for(const bad of [
    {...patient(),patientId:null,patient:null},
    {...patient(),patient:{...patient().patient,status:"INACTIVE"}},
    {...patient(),patient:{...patient().patient,status:"MERGED"}},
    {...patient(),patient:{...patient().patient,organizationId:"tenant-b"}},
    {...patient(),patient:{...patient().patient,id:"patient-b"}},
    {...corporate(),clientId:null,client:null},
    {...corporate(),client:{...corporate().client,status:"INACTIVE"}},
    {...corporate(),client:{...corporate().client,organizationId:"tenant-b"}},
    {...corporate(),client:{...corporate().client,id:"client-b"}},
  ])assert.deepEqual(resolvePortalBookingActor(bad),{kind:"DENIED"});
});

test("F7 clinical read: both server-rendered portal surfaces reject stale patient/client linkage before sensitive reads",()=>{
  const dashboard=readFileSync("src/app/portal/page.tsx","utf8");
  const report=readFileSync("src/app/portal/reports/[versionId]/page.tsx","utf8");
  for(const [source,label,firstSensitiveQuery] of [
    [dashboard,"dashboard","prisma.corporatePortalPatientAccess.findMany"],
    [report,"report detail","prisma.diagnosticReportVersion.findUnique"],
  ] as const){
    const guard=source.indexOf('resolvePortalBookingActor(account).kind === "DENIED"');
    assert.ok(guard>0,label+" must check the active patient/client principal");
    assert.ok(source.includes('account.type !== "DOCTOR" &&'),label+" does not change physician path");
    assert.ok(source.includes('if (account.type === "DOCTOR" && !hasLiveDoctorPortalReferrer(account)) notFound()'),
      label+" must preserve doctor clinical revocation");
    assert.ok(guard < source.indexOf(firstSensitiveQuery),
      label+" must deny stale links before querying patient or clinical data");
    assert.match(source,/resolvePortalBookingActor\(account\)\.kind === "DENIED"\) notFound\(\)/);
  }
  const guard=dashboard.indexOf('resolvePortalBookingActor(account).kind === "DENIED"');
  for(const clinicalRead of [
    "prisma.labOrder.findMany", "prisma.diagnosticReportVersion.findMany",
    "prisma.appointment.findMany", "prisma.invoice.findMany",
  ]){
    assert.ok(guard<dashboard.indexOf(clinicalRead),
      "guard precedes all clinical and financial disclosure queries: "+clinicalRead);
  }
  assert.ok(report.indexOf('resolvePortalBookingActor(account).kind === "DENIED"') <
    report.indexOf('prisma.reportDeliveryEvent.create'),
    "invalid account must not generate misleading report delivery receipts");
  assert.match(report,/canViewReports: true/,"corporate patient report grant is still required");
  assert.match(report,/doctorAccessWhere\(\{ organizationId: account\.organizationId/,
    "physicians still require explicit per-patient report access");
});

test("F7 clinical read: portal principal validation uses live session relations, not a request-supplied patient ID",()=>{
  const session=readFileSync("src/lib/portal-auth.ts","utf8");
  const actor=readFileSync("src/lib/portal-booking-actor.ts","utf8");
  assert.match(session,/portalAccount: \{ status: "ACTIVE", organization: \{ status: "ACTIVE" \} \}/);
  assert.match(session,/patient: true/);
  assert.match(session,/client: true/);
  assert.match(actor,/account\.patient\.organizationId!==account\.organizationId/);
  assert.match(actor,/account\.client\.organizationId!==account\.organizationId/);
  assert.match(actor,/account\.patient\.status!=="ACTIVE"/);
  assert.match(actor,/account\.client\.status!=="ACTIVE"/);
});
