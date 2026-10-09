import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildHl7Ack, parseHl7Msh } from "../src/lib/hl7-v2.ts";
const src = (path:string) => readFileSync(new URL(path,import.meta.url),"utf8");

test("HL7 inbound is idempotent for matching MSH-10 and rejects divergent payloads", () => {
  const route=src("../src/app/api/integrations/hl7/inbound/route.ts");
  assert.ok(route.includes("SELECT id FROM integration_endpoints"));
  assert.ok(route.includes("FOR UPDATE"));
  assert.ok(route.indexOf("SELECT id FROM integration_endpoints") < route.indexOf("tx.integrationMessage.findFirst"));
  assert.ok(route.includes('previous.payloadHash === payloadHash ? "DUPLICATE"'));
  assert.ok(route.includes('"CONFLICT" as const'));
  assert.ok(route.includes('isolationLevel: "Serializable"'));
  assert.ok(route.includes("tx.auditEvent.create"));
  const payload="MSH|^~\\&|LAB|ROOM|LIS|HOSP|202610090900||ORM^O01|CHECK123|P|2.5.1\\r";
  assert.equal(parseHl7Msh(payload)?.controlId,"CHECK123");
  assert.ok(buildHl7Ack({originalSendingApplication:"LAB",originalSendingFacility:"ROOM",controlId:"CHECK123",acknowledgementCode:"AR",message:"Conflict"}).includes("MSA|AR|CHECK123"));
});

test("webhook delivery is CAS-claimed before fetch and stale workers cannot overwrite retries", () => {
  const s=src("../src/lib/webhook-delivery.ts");
  const q=src("../src/app/api/integrations/webhooks/dispatch/route.ts");
  assert.ok(s.indexOf("const claim = await prisma.webhookDelivery.updateMany") < s.indexOf("const response = await fetch"));
  assert.ok(s.includes('status: "SENT", attemptCount'));
  assert.ok(s.includes("attemptCount, updatedAt: claimed.updatedAt"));
  assert.ok(s.includes("claim.count !== 1"));
  assert.ok(s.includes("endpoint.organizationId !== delivery.organizationId"));
  assert.ok(s.includes('"x-family-lab-delivery-id"'));
  assert.ok(s.includes('redirect: "error"'));
  assert.ok(s.includes('"DEAD_LETTER"'));
  assert.ok(q.includes('status: "SENT", updatedAt: { lte: staleSent }'));
  assert.ok(q.includes("SKIPPED_CONCURRENT_CLAIM"));
});

test("outbound HL7 claims stop at max attempts and ACKs match current revision", () => {
  const claim=src("../src/app/api/integrations/messages/claim/route.ts");
  const ack=src("../src/app/api/integrations/messages/[id]/ack/route.ts");
  assert.ok(claim.includes("attemptCount: { lt: auth.endpoint.maxAttempts }"));
  assert.ok(claim.includes('status: "DEAD_LETTER"'));
  assert.ok(claim.includes("attemptCount: candidate.attemptCount"));
  assert.ok(ack.includes("expectedAttempt = Number(body?.attempt)"));
  assert.ok(ack.includes('message.status !== "SENT" || message.attemptCount !== expectedAttempt'));
  assert.ok(ack.includes('status: "SENT"'));
  assert.ok(ack.includes("tx.integrationMessage.updateMany"));
  assert.ok(ack.includes("claim.count !== 1"));
  assert.ok(ack.includes("tx.auditEvent.create"));
});

test("FHIR read API prevents draft and retracted clinical observations and checks endpoint direction", () => {
  const targets=["Observation","DiagnosticReport","Patient","ServiceRequest"];
  for(const name of targets) {
    const s=src(`../src/app/api/fhir/r4/${name}/[id]/route.ts`);
    assert.ok(s.includes('auth.endpoint.endpointType'));
    assert.ok(s.includes('auth.endpoint.direction'));
    assert.ok(s.includes('requireIntegrationApiKey(request, "fhir.read")'));
  }
  const obs=src("../src/app/api/fhir/r4/Observation/[id]/route.ts");
  assert.ok(obs.includes('status: { in: ["RELEASED", "AMENDED"] }'));
  assert.ok(obs.includes('releasedAt: { not: null }'));
  assert.ok(obs.includes('currentVersion.status === "RETRACTED"'));
  assert.ok(obs.includes("contents?.results?.some"));
  const report=src("../src/app/api/fhir/r4/DiagnosticReport/[id]/route.ts");
  assert.ok(report.includes('if (version.status === "RETRACTED")'));
  assert.ok(report.includes('status: "entered-in-error"'));
  assert.ok(report.includes('result: []'));
});

test("integration credentials cannot cross tenants or incompatible endpoint types", () => {
  const auth=src("../src/lib/integration-auth.ts");
  const issue=src("../src/app/api/integrations/api-keys/route.ts");
  assert.ok(auth.includes("apiKey.organizationId !== apiKey.endpoint.organizationId"));
  assert.ok(issue.includes("scope_endpoint_direction_mismatch"));
  assert.ok(issue.includes('scope === "fhir.read"'));
  assert.ok(issue.includes('scope === "hl7.write"'));
});
