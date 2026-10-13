import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(name:string)=>readFileSync(new URL(name,import.meta.url),"utf8");

test("Stage 109 work-order claim has bounded one-at-a-time opt-in contract and expiry evidence",()=>{
  const claim=read("../src/app/api/integrations/analyzers/[id]/work-orders/claim/route.ts");
  assert.match(claim,/authenticateAnalyzerBridge\(request, id\)/);
  assert.match(claim,/limit = Number\(requested\)/);
  assert.match(claim,/take: limit/);
  assert.match(claim,/leaseExpiresAt: expires\.toISOString\(\)/);
  assert.match(claim,/FROM specimens/);
  assert.match(claim,/FOR UPDATE/);
  assert.match(claim,/analyzerWorkOrderClinicalEligibility/);
});

test("Stage 109 acknowledgement is lease-expiry fenced and replays only the exact token and wire fingerprint",()=>{
  const ack=read("../src/app/api/integrations/analyzers/[id]/work-orders/[workOrderId]/ack/route.ts");
  const schema=read("../prisma/schema.prisma");
  const migration=read("../prisma/migrations/20261013160000_analyzer_work_order_ack_replay/migration.sql");
  assert.match(ack,/acknowledgementFingerprint/);
  assert.match(ack,/current\.lastAckTokenHash === claimTokenHash/);
  assert.match(ack,/current\.lastAckFingerprint === acknowledgementFingerprint/);
  assert.match(ack,/current\.status !== "CLAIMED"/);
  assert.match(ack,/current\.leaseExpiresAt <= now/);
  assert.match(ack,/leaseExpiresAt: \{ gt: now \}/);
  assert.match(ack,/lastAckTokenHash: claimTokenHash/);
  assert.match(ack,/lastAckFingerprint: acknowledgementFingerprint/);
  assert.match(ack,/direction: "OUTBOUND"/);
  assert.match(ack,/ANALYZER_WORK_ORDER_ACKNOWLEDGED/);
  assert.match(schema,/lastAckTokenHash/);
  assert.match(schema,/lastAckFingerprint/);
  assert.match(migration,/ADD COLUMN \x60last_ack_token_hash\x60/);
  assert.match(migration,/ADD COLUMN \x60last_ack_fingerprint\x60/);
});

test("Stage 109 outbound bridge cannot claim or fabricate device transmission by default",()=>{
  const worker=read("../bridge/outbound-worker.mjs");
  assert.match(worker,/ANALYZER_BRIDGE_OUTBOUND_ENABLED/);
  assert.match(worker,/OUTBOUND_APPROVED_FILE_HANDOFF_REQUIRED/);
  assert.match(worker,/limit:1/);
  assert.match(worker,/CLAIM_DURABLY_STAGED_NOT_SENT/);
  assert.match(worker,/WAITING_FOR_VENDOR_RECEIPT/);
  assert.match(worker,/OUTBOUND_RECEIPT_RAW_REQUIRED/);
  assert.match(worker,/OUTBOUND_LEASE_CONFLICT_REQUIRES_RECONCILIATION/);
  assert.match(worker,/OUTBOUND_WORKER_ALREADY_ACTIVE_OR_STALE_LOCK/);
  assert.match(worker,/PREVIOUS_DEVICE_ATTEMPT_REQUIRES_RECONCILIATION/);
  assert.match(worker,/await fd\.sync\(\)/);
  assert.match(worker,/await link\(temp, join\(dir, name\)\)/);
  assert.doesNotMatch(worker,/\.write\(.*(?:port|socket|serial)/);
});
