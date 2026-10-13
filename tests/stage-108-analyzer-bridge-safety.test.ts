import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(path:string)=>readFileSync(new URL(path,import.meta.url),"utf8");

test("Stage 108 preserves authentic raw HL7/ASTM bytes, verifies idempotent message conflicts and audits",()=>{
  const route=read("../src/app/api/integrations/analyzers/[id]/messages/route.ts");
  assert.match(route,/const rawPayload = body\.rawPayload;/);
  assert.match(route,/Buffer\.byteLength\(rawPayload, "utf8"\)/);
  assert.doesNotMatch(route,/text\(body\.rawPayload/);
  assert.match(route,/winner\.payloadHash !== payloadHash/);
  assert.match(route,/error\.code === "P2002"/);
  assert.match(route,/ANALYZER_MESSAGE_RECEIVED/);
});

test("Stage 108 serializes each analyzer observation staging and rechecks physical custody",()=>{
  const route=read("../src/app/api/integrations/analyzers/[id]/results/route.ts");
  const lock=route.indexOf("FROM analyzer_messages");
  const reread=route.indexOf("tx.analyzerResultImport.findMany",lock);
  const custody=route.indexOf("FROM specimens",reread);
  const staging=route.indexOf("tx.analyzerResultImport.create",custody);
  assert.ok(lock>0 && reread>lock && custody>reread && staging>custody);
  assert.match(route.slice(lock,reread),/FOR UPDATE/);
  assert.match(route.slice(custody,staging),/FOR UPDATE/);
  assert.match(route,/BRIDGE_OBSERVATION_PAYLOAD_CHANGED/);
  assert.match(route,/credential\.analyzer\.organizationId/);
  assert.match(route,/analyzerRoutingAllowsImport/);
});

test("Stage 108 bridge never auto-releases results and requires vendor-specific HL7/ASTM profiles",()=>{
  const parser=read("../bridge/protocols.mjs");
  const worker=read("../bridge/file-worker.mjs");
  const mllp=read("../bridge/mllp-listener.mjs");
  assert.match(parser,/HL7_BARCODE_PROFILE_REQUIRED/);
  assert.match(parser,/ASTM_APPROVED_PROFILE_REQUIRED/);
  assert.match(parser,/ASTM_TRANSPORT_FRAME_UNVERIFIED/);
  assert.match(worker,/TextDecoder\("utf-8",\{fatal:true\}\)/);
  assert.match(worker,/ANALYZER_BRIDGE_TOKEN/);
  assert.match(mllp,/await storeDurably\(inputDir,raw\)/);
  assert.match(mllp,/MLLP_REMOTE_REQUIRES_IP_ALLOWLIST/);
  for(const code of [parser,worker,mllp]){
    assert.doesNotMatch(code,/(?:diagnosticReport|resultRelease|releaseClinicalResult)\.(?:create|update|delete)\(/);
  }
});
