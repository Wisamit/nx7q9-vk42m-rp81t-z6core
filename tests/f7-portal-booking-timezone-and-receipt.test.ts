import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolveBranchLocalDateTime} from "../src/lib/branch-local-date-time.ts";
import {requestPortalBooking,type PortalBookingPayload} from "../src/lib/portal-booking-client.ts";

const appointmentId="123e4567-e89b-42d3-a456-426614174000";
const payload:PortalBookingPayload={
  branchId:"branch-a",patientId:"patient-a",mode:"ONSITE",
  serviceCode:"CBC",serviceNameSnapshot:"Synthetic lab visit",
  scheduledStartLocal:"2026-10-22T09:30",address:"",notes:"",
};
const json=(body:unknown,status=201)=>new Response(JSON.stringify(body),{
  status,headers:{"content-type":"application/json"},
});
const accepted=(overrides:Record<string,unknown>={})=>json({
  status:"ok",
  appointment:{id:appointmentId,status:"REQUESTED",
    branchId:payload.branchId,patientId:payload.patientId,
    ...overrides},
});

test("F7 booking: convert local wall time using selected branch rather than host/browser timezone",()=>{
  assert.equal(resolveBranchLocalDateTime("2026-10-22T09:30","Asia/Dubai")?.toISOString(),
    "2026-10-22T05:30:00.000Z");
  assert.equal(resolveBranchLocalDateTime("2026-10-22T09:30","Asia/Tokyo")?.toISOString(),
    "2026-10-22T00:30:00.000Z");
  assert.equal(resolveBranchLocalDateTime("2026-10-22T09:30","Etc/UTC")?.toISOString(),
    "2026-10-22T09:30:00.000Z");
  assert.equal(resolveBranchLocalDateTime("2026-01-15T10:45","Europe/Berlin")?.toISOString(),
    "2026-01-15T09:45:00.000Z");
  assert.equal(resolveBranchLocalDateTime("2026-07-15T10:45","Europe/Berlin")?.toISOString(),
    "2026-07-15T08:45:00.000Z");
});

test("F7 booking: ambiguous DST fallback and nonexistent spring-forward local time are rejected",()=>{
  assert.equal(resolveBranchLocalDateTime("2026-03-08T02:30","America/New_York"),null,
    "DST gap cannot be moved silently to a different appointment time");
  assert.equal(resolveBranchLocalDateTime("2026-11-01T01:30","America/New_York"),null,
    "DST overlap has two instants and needs an explicit other time");
  assert.equal(resolveBranchLocalDateTime("2026-03-08T03:30","America/New_York")?.toISOString(),
    "2026-03-08T07:30:00.000Z");
  assert.equal(resolveBranchLocalDateTime("2026-11-01T02:30","America/New_York")?.toISOString(),
    "2026-11-01T07:30:00.000Z");
  assert.equal(resolveBranchLocalDateTime("2026-10-22T09:30","Not/A_Zone"),null);
  assert.equal(resolveBranchLocalDateTime("2026-02-30T09:30","Asia/Dubai"),null);
  assert.equal(resolveBranchLocalDateTime("2026-10-22T24:30","Asia/Dubai"),null);
  assert.equal(resolveBranchLocalDateTime("2026-10-22 09:30","Asia/Dubai"),null);
});

test("F7 booking: host process TZ cannot change branch-specific appointment instant",()=>{
  const command='import {resolveBranchLocalDateTime} from "./src/lib/branch-local-date-time.ts";'+
    'console.log(resolveBranchLocalDateTime("2026-10-22T09:30","Asia/Dubai")?.toISOString());';
  for(const timezone of ["UTC","America/Los_Angeles","Asia/Tokyo"]){
    const result=spawnSync(process.execPath,["--experimental-strip-types","--input-type=module","-e",command],{
      cwd:process.cwd(),env:{...process.env,TZ:timezone},encoding:"utf8",
    });
    assert.equal(result.status,0,result.stderr);
    assert.equal(result.stdout.trim(),"2026-10-22T05:30:00.000Z",timezone);
  }
});

test("F7 booking: only exact 201 confirmation of REQUESTED appointment for selected patient and branch is success",async()=>{
  const outcome=await requestPortalBooking(payload,async (url,init)=>{
    assert.equal(url,"/api/portal/appointments");
    assert.equal(init.method,"POST");
    assert.deepEqual(JSON.parse(init.body as string),payload);
    return accepted();
  });
  assert.deepEqual(outcome,{kind:"requested",appointmentId});
  for(const [description,response] of [
    ["accepted without row",json({status:"ok"})],
    ["unrecognized status",json({status:"pending",appointment:{id:appointmentId,status:"REQUESTED",branchId:"branch-a",patientId:"patient-a"}})],
    ["wrong branch",accepted({branchId:"branch-b"})],
    ["wrong patient",accepted({patientId:"patient-b"})],
    ["wrong appointment state",accepted({status:"CONFIRMED"})],
    ["bad ID",accepted({id:"not-a-uuid"})],
    ["200 with valid body",new Response(JSON.stringify({status:"ok",appointment:{id:appointmentId,status:"REQUESTED",branchId:"branch-a",patientId:"patient-a"}}),{status:200})],
    ["201 unreadable",new Response("not json",{status:201})],
    ["500 response after possible database commit",json({error:"internal"},500)],
  ] as Array<[string,Response]>) {
    assert.deepEqual(await requestPortalBooking(payload,async()=>response),{kind:"uncertain"},description);
  }
});

test("F7 booking: definite 4xx rejection is distinct from an unknown commit outcome",async()=>{
  assert.deepEqual(await requestPortalBooking(payload,async()=>json({error:"invalid_branch_local_schedule"},400)),
    {kind:"rejected",error:"invalid_branch_local_schedule"});
  assert.deepEqual(await requestPortalBooking(payload,async()=>new Response("no body",{status:403})),
    {kind:"rejected",error:"unknown"});
});

test("F7 booking: lost network response never automatically duplicates appointment creation",async()=>{
  let count=0;
  const lost=async():Promise<Response>=>{count++;throw Error("synthetic private transport failure");};
  assert.deepEqual(await requestPortalBooking(payload,lost),{kind:"uncertain"});
  assert.equal(count,1);
});

test("F7 booking: UI and API preserve branch timezone and fail closed on uncertain creation",()=>{
  const form=readFileSync("src/components/portal-booking-form.tsx","utf8");
  const api=readFileSync("src/app/api/portal/appointments/route.ts","utf8");
  const portal=readFileSync("src/app/portal/page.tsx","utf8");
  assert.ok(form.includes('parseSystemLocalDateTime(rawStart)'));
  assert.ok(form.includes("scheduledStartLocal: rawStart"));
  assert.ok(form.includes("requestPortalBooking({"));
  assert.ok(form.includes("if (outcome.kind === \"requested\")"));
  assert.ok(form.includes("if (outcome.kind === \"rejected\")"));
  assert.ok(form.includes("uncertain.current = true"));
  assert.ok(form.includes("setRequiresReconciliation(true)"));
  assert.ok(form.includes("disabled={busy || requiresReconciliation}"));
  assert.ok(form.includes("submitting.current = true"));
  assert.ok(form.includes("submitting.current = false"));
  assert.doesNotMatch(form,/new Date\(rawStart\)|date\.toISOString\(\)/);
  assert.ok(api.includes("resolveBranchLocalDateTime(body.scheduledStartLocal, branch.timezone)"));
  assert.ok(api.includes('error: usesBranchClock ? "invalid_branch_local_schedule"'));
  assert.ok(api.includes("const usesBranchClock = body?.scheduledStartLocal !== undefined"));
  assert.ok(api.includes('new Date(String(body?.scheduledStart || ""))'),
    "legacy ISO timestamp clients retain the old API input");
  assert.ok(api.includes('status: "REQUESTED"'));
  assert.ok(portal.includes("timezone: true"));
  assert.ok(portal.includes("timeZone: branch.timezone"));
});
