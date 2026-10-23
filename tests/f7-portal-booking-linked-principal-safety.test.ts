import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolvePortalBookingActor} from "../src/lib/portal-booking-actor.ts";

const org="org-a";
const patient=()=>({
  type:"PATIENT",organizationId:org,patientId:"patient-a",clientId:null,
  patient:{id:"patient-a",organizationId:org,status:"ACTIVE"},client:null,
});
const corporate=()=>({
  type:"CORPORATE",organizationId:org,patientId:null,clientId:"client-a",
  patient:null,client:{id:"client-a",organizationId:org,status:"ACTIVE"},
});

test("F7 booking: bound patient identity cannot fall back to arbitrary requested patient",()=>{
  assert.deepEqual(resolvePortalBookingActor(patient()),{kind:"PATIENT",patientId:"patient-a"});
  const missing={...patient(),patientId:null,patient:null};
  assert.deepEqual(resolvePortalBookingActor(missing),{kind:"DENIED"});
  assert.deepEqual(resolvePortalBookingActor({...patient(),patient:null}),{kind:"DENIED"});
  assert.deepEqual(resolvePortalBookingActor({...patient(),patient:{...patient().patient,id:"other"}}),{kind:"DENIED"});
  assert.deepEqual(resolvePortalBookingActor({...patient(),patient:{...patient().patient,organizationId:"org-b"}}),{kind:"DENIED"});
  assert.deepEqual(resolvePortalBookingActor({...patient(),patient:{...patient().patient,status:"INACTIVE"}}),{kind:"DENIED"});
  assert.deepEqual(resolvePortalBookingActor({...patient(),patient:{...patient().patient,status:"MERGED"}}),{kind:"DENIED"});
});

test("F7 booking: corporate session alone never authorizes a missing, inactive or foreign linked client",()=>{
  assert.deepEqual(resolvePortalBookingActor(corporate()),{kind:"CORPORATE",clientId:"client-a"});
  assert.deepEqual(resolvePortalBookingActor({...corporate(),clientId:null,client:null}),{kind:"DENIED"});
  assert.deepEqual(resolvePortalBookingActor({...corporate(),client:null}),{kind:"DENIED"});
  assert.deepEqual(resolvePortalBookingActor({...corporate(),client:{...corporate().client,id:"other"}}),{kind:"DENIED"});
  assert.deepEqual(resolvePortalBookingActor({...corporate(),client:{...corporate().client,organizationId:"org-b"}}),{kind:"DENIED"});
  assert.deepEqual(resolvePortalBookingActor({...corporate(),client:{...corporate().client,status:"INACTIVE"}}),{kind:"DENIED"});
  for(const type of ["DOCTOR","ADMIN","UNKNOWN"]){
    assert.deepEqual(resolvePortalBookingActor({...patient(),type}),{kind:"DENIED"});
  }
});

test("F7 booking: route checks linked tenant and patient before reading user-controlled booking data",()=>{
  const api=readFileSync("src/app/api/portal/appointments/route.ts","utf8");
  const auth=readFileSync("src/lib/portal-auth.ts","utf8");
  const guard=api.indexOf("const actor = resolvePortalBookingActor(account);");
  const json=api.indexOf("const body = await request.json()");
  const insert=api.indexOf("tx.appointment.create(");
  assert.ok(guard>=0 && json>guard && insert>guard,
    "deny invalid principal before processing patientId or committing a booking");
  assert.match(api,/if \(actor.kind === "DENIED"\) \{\s*return NextResponse.json\(\{ error: "portal_unauthorized" \}, \{ status: 401 \}\);/);
  assert.match(api,/actor.kind === "PATIENT" \? actor.patientId : requestedPatientId/);
  assert.match(api,/if \(actor.kind === "CORPORATE"\)/);
  assert.match(api,/clientId: actor.clientId/);
  assert.doesNotMatch(api,/account.patientId \|\| requestedPatientId/,
    "missing PATIENT link must never use an untrusted patientId fallback");
  assert.match(api,/organizationId: account.organizationId, status: "ACTIVE"/);
  assert.match(api,/canBook: true/);
  assert.match(auth,/patient: true/);
  assert.match(auth,/client: true/);
});
