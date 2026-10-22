import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {randomUUID} from "node:crypto";
import {
  portalBookingSubmissionKey, portalBookingIntentHash,evaluatePortalBookingReplay,
} from "../src/lib/portal-appointment-idempotency.ts";
import {requestPortalBooking,type PortalBookingPayload} from "../src/lib/portal-booking-client.ts";

const key=randomUUID();
const id=randomUUID();
const payload:PortalBookingPayload={
  branchId:"branch",patientId:"patient",mode:"HOME_COLLECTION",
  serviceCode:"CBC",serviceNameSnapshot:"Synthetic Test",
  scheduledStartLocal:"2026-10-23T10:00",address:"Synthetic address",
  notes:"Synthetic note",submissionKey:key,
};

test("F7 keyed portal booking: UUID validation is strict and optional legacy values remain valid",()=>{
  assert.deepEqual(portalBookingSubmissionKey(null),{valid:true,key:null});
  assert.deepEqual(portalBookingSubmissionKey(key.toUpperCase()),{valid:true,key});
  for(const bad of ["","123","not-a-uuid",key+"-extra"])
    assert.deepEqual(portalBookingSubmissionKey(bad),{valid:false,key:null});
});

test("F7 keyed portal booking: same intent hash is order-insensitive but binds actor/patient/branch/time/visit/address",()=>{
  const fields={portalAccountId:"actor",branchId:"branch",patientId:"patient",
    mode:"ONSITE",serviceCode:"CBC",serviceNameSnapshot:"Synthetic",
    address:"",notes:"",timeSource:"BRANCH_LOCAL",requestedTime:"2026-10-23T10:00"};
  const hash=portalBookingIntentHash(fields);
  assert.match(hash,/^[a-f0-9]{64}$/);
  assert.equal(hash,portalBookingIntentHash(Object.fromEntries(
    Object.entries(fields).reverse()) as typeof fields));
  for(const change of [{portalAccountId:"other"},{branchId:"other"},
    {patientId:"other"},{mode:"HOME_COLLECTION"},{serviceCode:"CMP"},
    {address:"Changed"},{notes:"Changed"},{requestedTime:"2026-10-24T10:00"}]){
    assert.notEqual(hash,portalBookingIntentHash({...fields,...change}));
  }
  assert.ok(!hash.includes("Synthetic"),"stored fingerprint must not reveal appointment text");
});

test("F7 keyed portal booking: equal hashed replay returns existing appointment even after state advances",()=>{
  const hash=portalBookingIntentHash({account:"portal",branch:"one"});
  assert.deepEqual(evaluatePortalBookingReplay(null,hash),{kind:"new"});
  const previous={id,status:"CONFIRMED",branchId:"branch",patientId:"patient",portalSubmissionHash:hash};
  assert.deepEqual(evaluatePortalBookingReplay(previous,hash),{kind:"replay",appointment:previous});
  assert.equal(evaluatePortalBookingReplay({...previous,portalSubmissionHash:null},hash).kind,"conflict");
  assert.equal(evaluatePortalBookingReplay({...previous,portalSubmissionHash:"0".repeat(64)},hash).kind,"conflict");
});

test("F7 keyed portal booking: client uses UUID in header, excludes from PII body and handles 200 exact replay",async()=>{
  const first=await requestPortalBooking(payload,async(url,init)=>{
    assert.equal(url,"/api/portal/appointments");
    assert.equal((init.headers as Record<string,string>)["x-family-lab-portal-appointment-key"],key);
    const json=JSON.parse(init.body as string);
    assert.equal("submissionKey" in json,false);
    const {submissionKey: _key,...booking} = payload;
    assert.deepEqual(json,booking);
    return new Response(JSON.stringify({
      status:"ok",appointment:{id,branchId:"branch",patientId:"patient",status:"REQUESTED"},
    }),{status:201});
  });
  assert.deepEqual(first,{kind:"requested",appointmentId:id});
  const replay=await requestPortalBooking(payload,async()=>new Response(JSON.stringify({
    status:"ok",replayed:true,
    appointment:{id,branchId:"branch",patientId:"patient",status:"CONFIRMED"},
  }),{status:200}));
  assert.deepEqual(replay,{kind:"requested",appointmentId:id,replayed:true});
  for(const [name,response] of [
    ["200 no replay",new Response(JSON.stringify({
      status:"ok",appointment:{id,branchId:"branch",patientId:"patient",status:"REQUESTED"},
    }),{status:200})],
    ["replay wrong patient",new Response(JSON.stringify({
      status:"ok",replayed:true,
      appointment:{id,branchId:"branch",patientId:"different",status:"CONFIRMED"},
    }),{status:200})],
    ["replay invalid status",new Response(JSON.stringify({
      status:"ok",replayed:true,
      appointment:{id,branchId:"branch",patientId:"patient",status:"INVALID"},
    }),{status:200})],
  ] as Array<[string,Response]>){
    assert.deepEqual(await requestPortalBooking(payload,async()=>response),{kind:"uncertain"},name);
  }
});

test("F7 keyed portal booking: schema, index and API enforce per-account replay without duplicate side effects",()=>{
  const schema=readFileSync("prisma/schema.prisma","utf8");
  const migration=readFileSync(
    "prisma/migrations/20261022213000_portal_appointment_submission_idempotency/migration.sql",
    "utf8");
  const api=readFileSync("src/app/api/portal/appointments/route.ts","utf8");
  const ui=readFileSync("src/components/portal-booking-form.tsx","utf8");
  assert.match(schema, /portalSubmissionKey\s+String\?/);
  assert.match(schema, /portalSubmissionHash\s+String\?/);
  assert.ok(schema.includes('@@unique([portalAccountId, portalSubmissionKey], map: "appointment_portal_submission_uq")'));
  assert.ok(migration.includes("ADD UNIQUE INDEX `appointment_portal_submission_uq`"));
  assert.ok(api.includes('request.headers.get("x-family-lab-portal-appointment-key")'));
  assert.ok(api.includes("const earlierSubmission = await replayResponse()"));
  assert.ok(api.indexOf("const earlierSubmission = await replayResponse()")<
    api.indexOf("scheduledStart <= new Date()"),
    "replay must precede changed wall-time/future restrictions");
  assert.ok(api.includes('portalSubmissionKey: submission.key'));
  assert.ok(api.includes('portalSubmissionHash: payloadHash'));
  assert.ok(api.includes('error.code === "P2002"'));
  assert.ok(api.includes("const existing = await replayResponse()"));
  assert.ok(api.includes('return NextResponse.json({'));
  assert.ok(api.includes("tx.homeCollectionVisit.create"));
  assert.ok(api.includes("tx.auditEvent.create"));
  assert.ok(ui.includes("bookingKey.current ??= crypto.randomUUID()"));
  assert.ok(ui.includes("originalRequest.current = intent"));
  assert.ok(ui.includes("requestPortalBooking(intent)"));
  assert.ok(ui.includes("async function retryOriginal()"));
  assert.ok(ui.includes("requiresReconciliation"));
  assert.ok(ui.includes("bookingKey.current = null"));
});
