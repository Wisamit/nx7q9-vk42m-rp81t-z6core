import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

test("raw messages retain exact original frame bytes and use DB-backed duplicate resolution", () => {
  const api=source("../src/app/api/integrations/analyzers/[id]/messages/route.ts");
  assert.ok(api.includes('const rawPayload = body.rawPayload'));
  assert.ok(api.includes('Buffer.byteLength(rawPayload, "utf8")'));
  assert.ok(api.includes('error: "raw_payload_too_large"'));
  assert.ok(!api.includes('text(body.rawPayload'));
  assert.ok(api.includes('error.code === "P2002"'));
  assert.ok(api.includes("winner.payloadHash !== payloadHash"));
});

test("normalized analyzer staging locks parent and fresh imports before assigning clinical mappings", () => {
  const api=source("../src/app/api/integrations/analyzers/[id]/results/route.ts");
  const transaction=api.indexOf("const staged = await prisma.$transaction");
  const parent=api.indexOf("FROM analyzer_messages",transaction);
  const fresh=api.indexOf("tx.analyzerResultImport.findMany",parent);
  const custody=api.indexOf("FROM specimens",fresh);
  const output=api.indexOf("for (const item of processableItems)",custody);
  const insert=api.indexOf("tx.analyzerResultImport.create",output);
  assert.ok(transaction>=0 && parent>transaction && fresh>parent && custody>fresh && output>custody && insert>output);
  assert.ok(api.slice(parent,fresh).includes("FOR UPDATE"));
  assert.ok(api.slice(custody,output).includes("FOR UPDATE"));
  assert.ok(api.includes("liveByObservation.get(item.observationId)"));
  assert.ok(api.includes("BRIDGE_OBSERVATION_PAYLOAD_CHANGED"));
  assert.ok(api.includes('error: "bridge_observation_state_or_payload_conflict"'));
});

test("clinical import claims locked specimen, mapped import rows and exact editable result revision", () => {
  const api=source("../src/app/api/analyzers/imports/commit/route.ts");
  const transaction=api.indexOf("const saved = await prisma.$transaction");
  const specimen=api.indexOf("FROM specimens",transaction);
  const lineage=api.indexOf("tx.specimenOrderItem.count",specimen);
  const stagedRows=api.indexOf("FROM analyzer_result_imports",lineage);
  const revision=api.indexOf("tx.laboratoryResult.updateMany",stagedRows);
  const values=api.indexOf("tx.laboratoryResultValue.",revision);
  assert.ok(transaction>=0 && specimen>transaction && lineage>specimen && stagedRows>lineage && revision>stagedRows && values>revision);
  assert.ok(api.slice(specimen,lineage).includes("FOR UPDATE"));
  assert.ok(api.slice(stagedRows,revision).includes("FOR UPDATE"));
  assert.ok(api.slice(revision,values).includes('updatedAt: existing.updatedAt'));
  assert.ok(api.slice(revision,values).includes('source: "ANALYZER"'));
  assert.ok(api.includes("if (consumed.count !== importIds.length)"));
  assert.ok(api.includes("ANALYZER_IMPORT_CONCURRENT_STATE_CHANGE"));
});

test("device bridge is separate from web server, persists MLLP before ACK, and fails closed on unapproved AST transport", () => {
  const listener=source("../bridge/mllp-listener.mjs");
  const worker=source("../bridge/file-worker.mjs");
  const parser=source("../bridge/protocols.mjs");
  assert.ok(listener.includes("await storeDurably(inputDir,raw)"));
  assert.ok(listener.includes("socket.write(ack(id,true))"));
  assert.ok(listener.includes("MLLP_REMOTE_REQUIRES_IP_ALLOWLIST"));
  assert.ok(worker.includes("ANALYZER_BRIDGE_TOKEN"));
  assert.ok(worker.includes('endsWith(".ready")'));
  assert.ok(worker.includes("RETRY_PENDING"));
  assert.ok(parser.includes("ASTM_TRANSPORT_FRAME_UNVERIFIED"));
  assert.ok(parser.includes("ASTM_APPROVED_PROFILE_REQUIRED"));
  assert.ok(parser.includes("HL7_BARCODE_PROFILE_REQUIRED"));
});
