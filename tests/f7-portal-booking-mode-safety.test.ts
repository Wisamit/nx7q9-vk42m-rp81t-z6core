import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { portalBookingMode } from "../src/lib/portal-appointment-idempotency.ts";
import { requestPortalBooking, type PortalBookingPayload } from "../src/lib/portal-booking-client.ts";

test("F7 booking: explicit home/onsite mode is strict; missing legacy mode remains onsite",()=>{
  for(const raw of [undefined,null,"","ONSITE"])
    assert.equal(portalBookingMode(raw),"ONSITE");
  assert.equal(portalBookingMode("HOME_COLLECTION"),"HOME_COLLECTION");
  for(const invalid of ["HOME_COLLECT","home_collection"," ONSITE ",false,0,1,{},[],["HOME_COLLECTION"]])
    assert.equal(portalBookingMode(invalid),null,String(invalid));
});

test("F7 booking: invalid explicit mode fails before any reservation or audit mutation",()=>{
  const api=readFileSync("src/app/api/portal/appointments/route.ts","utf8");
  assert.match(api,/const mode = portalBookingMode\(body\?\.mode\);/);
  assert.match(api,/if \(!mode\) \{\s*return NextResponse\.json\(\{ error: "invalid_booking_request" \}, \{ status: 400 \}\);\s*\}/);
  assert.ok(api.indexOf("const mode = portalBookingMode(body?.mode)")<
    api.indexOf("portalBookingIntentHash({"));
  assert.ok(api.indexOf("const mode = portalBookingMode(body?.mode)")<
    api.indexOf("tx.appointment.create("));
  assert.ok(!api.includes('body?.mode === "HOME_COLLECTION" ? "HOME_COLLECTION" : "ONSITE"'),
    "unknown visit mode cannot silently downgrade to onsite");
});

test("F7 booking: a documented invalid mode error is a definitive 400, not a new appointment",async()=>{
  const request:PortalBookingPayload={
    branchId:"branch",patientId:"patient",mode:"HOME_COLLECTION",
    serviceCode:"CBC",serviceNameSnapshot:"Synthetic visit",
    scheduledStartLocal:"2026-10-24T09:00",address:"Synthetic collection address",notes:"",
  };
  let n=0;
  const outcome=await requestPortalBooking(request,async()=>{
    n++;
    return new Response(JSON.stringify({error:"invalid_booking_request"}),{status:400});
  });
  assert.deepEqual(outcome,{kind:"rejected",error:"invalid_booking_request"});
  assert.equal(n,1,"client must not automatically create a fallback onsite request");
});
