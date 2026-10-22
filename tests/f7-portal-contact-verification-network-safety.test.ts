import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {requestContactChallenge,verifyContactChallenge} from "../src/lib/portal-contact-verification-client.ts";

const uuid="123e4567-e89b-42d3-a456-426614174000";
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{"content-type":"application/json"},
});
const queued=()=>json({status:"queued",challengeId:uuid,destination:"a***@example.test"},201);

test("F7 portal contact: only a well-formed 201 challenge receipt authorizes an OTP entry form",async()=>{
  const result=await requestContactChallenge("EMAIL",async (url,options)=>{
    assert.equal(url,"/api/portal/auth/contact-verification/request");
    assert.equal(options.method,"POST");
    assert.deepEqual(JSON.parse(options.body as string),{channel:"EMAIL"});
    return queued();
  });
  assert.deepEqual(result,{kind:"queued",challengeId:uuid,destination:"a***@example.test"});
  for(const [name,response] of [
    ["missing challenge ID",json({status:"queued",destination:"masked"},201)],
    ["invalid challenge ID",json({status:"queued",challengeId:"not-an-id",destination:"masked"},201)],
    ["missing destination",json({status:"queued",challengeId:uuid},201)],
    ["unconfirmed status",json({status:"pending",challengeId:uuid,destination:"masked"},201)],
    ["HTTP 200 masquerading as queued",json({status:"queued",challengeId:uuid,destination:"masked"},200)],
    ["server error after commit",json({error:"internal"},500)],
    ["unstructured 201 response",new Response("not-json",{status:201})],
  ] as Array<[string,Response]>){
    const actual=await requestContactChallenge("SMS",async()=>response);
    assert.deepEqual(actual,{kind:"uncertain"},name);
  }
});

test("F7 portal contact: only an explicit 200 verified receipt permits UI success",async()=>{
  const result=await verifyContactChallenge(uuid,"123456",async (url,options)=>{
    assert.equal(url,"/api/portal/auth/contact-verification/verify");
    assert.deepEqual(JSON.parse(options.body as string),{challengeId:uuid,code:"123456"});
    return json({status:"verified",emailVerifiedAt:"2026-10-22T00:00:00.000Z"});
  });
  assert.deepEqual(result,{kind:"verified"});
  for(const response of [
    json({status:"pending"}),
    json({status:"verified"},202),
    json({status:"verified"},500),
    new Response("not-json",{status:200}),
  ]){
    assert.deepEqual(await verifyContactChallenge(uuid,"123456",async()=>response),{kind:"uncertain"});
  }
});

test("F7 portal contact: 4xx known rejection preserves typed error without pretending mutation success",async()=>{
  assert.deepEqual(await requestContactChallenge("EMAIL",async()=>
    json({error:"rate_limited"},429)),{kind:"rejected",error:"rate_limited"});
  assert.deepEqual(await verifyContactChallenge(uuid,"123456",async()=>
    json({error:"invalid_verification_code"},400)),
    {kind:"rejected",error:"invalid_verification_code"});
  assert.deepEqual(await verifyContactChallenge(uuid,"123456",async()=>
    new Response("server-not-json",{status:409})),{kind:"rejected",error:"unknown"});
});

test("F7 portal contact: network failure and unreadable responses are uncertain and never retried automatically",async()=>{
  let attempts=0;
  const drop=async():Promise<Response>=>{attempts++;throw Error("Sensitive transport diagnostic");};
  assert.deepEqual(await requestContactChallenge("SMS",drop),{kind:"uncertain"});
  assert.equal(attempts,1,"request-side code must not silently reissue an OTP challenge");
  assert.deepEqual(await verifyContactChallenge(uuid,"123456",drop),{kind:"uncertain"});
  assert.equal(attempts,2,"verify-side code must not silently replay a potentially consumed OTP");
  const invalidJson=async()=>new Response("invalid-json",{status:201});
  assert.deepEqual(await requestContactChallenge("EMAIL",invalidJson),{kind:"uncertain"});
});

test("F7 portal contact: UI locks ambiguous mutations and clears obsolete challenge when channel changes",()=>{
  const src=readFileSync("src/components/portal-contact-verification.tsx","utf8");
  assert.match(src,/const pending = useRef\(false\)/);
  assert.match(src,/if \(pending.current \|\| requiresReconciliation\) return/);
  assert.match(src,/setRequiresReconciliation\(true\)/);
  assert.match(src,/pending.current = false/);
  assert.match(src,/setBusy\(""\)/);
  assert.match(src,/setChallengeId\(""\)/);
  assert.match(src,/function selectChannel\(next: VerificationChannel\)/);
  assert.match(src,/setDestination\(""\)/);
  assert.match(src,/disabled=\{busy !== "" \|\| requiresReconciliation\}/);
  assert.match(src,/role="status" aria-live="polite"/);
  assert.match(src,/router\.refresh\(\)/);
  assert.doesNotMatch(src,/await fetch\(/,
    "UI must not bypass the single shared fail-closed transport boundary");
});
