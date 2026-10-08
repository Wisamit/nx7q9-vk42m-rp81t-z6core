import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analyzerRetryDelaySeconds, analyzerWorkOrderClinicalEligibility } from "../src/lib/analyzer-work-orders.ts";

function source(path: string) { return readFileSync(new URL(path, import.meta.url), "utf8"); }

test("outbound analyzer retries are bounded", () => {
  assert.equal(analyzerRetryDelaySeconds(1),30);
  assert.equal(analyzerRetryDelaySeconds(2),60);
  assert.equal(analyzerRetryDelaySeconds(3),120);
  assert.equal(analyzerRetryDelaySeconds(7),1920);
  assert.equal(analyzerRetryDelaySeconds(100),3600);
});

test("dispatch blocks unsafe branch custody, cancelled work items and reviewed results", () => {
  const ready = {
    specimenStatus: "RECEIVED", currentBranchId: "b1", analyzerBranchId: "b1",
    orderItemStatus: "IN_PROGRESS", resultStatuses: ["ENTERED"], validationStages: ["ENTRY"],
  };
  assert.equal(analyzerWorkOrderClinicalEligibility(ready),"READY");
  assert.equal(analyzerWorkOrderClinicalEligibility({...ready,specimenStatus:"IN_PROCESS"}),"READY");
  for (const status of ["COLLECTED","IN_TRANSIT","QUARANTINED","REJECTED","DISPOSED"]) {
    assert.equal(analyzerWorkOrderClinicalEligibility({...ready,specimenStatus:status}),"SPECIMEN_UNREADY");
  }
  assert.equal(analyzerWorkOrderClinicalEligibility({...ready,currentBranchId:"b2"}),"SPECIMEN_UNREADY");
  assert.equal(analyzerWorkOrderClinicalEligibility({...ready,orderItemStatus:"CANCELLED"}),"ORDER_CANCELLED");
  for(const status of ["VERIFIED","RELEASED","AMENDED","CANCELLED"]) {
    assert.equal(analyzerWorkOrderClinicalEligibility({...ready,resultStatuses:[status]}),"RESULT_LOCKED");
  }
  assert.equal(analyzerWorkOrderClinicalEligibility({...ready,validationStages:["COMPLETE"]}),"RESULT_LOCKED");
});

test("assignment enqueues one immutable work order only after live mapping and specimen validation", () => {
  const api=source("../src/app/api/worklists/[orderItemId]/analyzers/route.ts");
  const tx=api.indexOf("const route = await prisma.$transaction");
  const lock=api.indexOf("FOR UPDATE",tx);
  const custody=api.indexOf("tx.specimenOrderItem.findFirst",lock);
  const approved=api.indexOf("tx.analyzerTestMapping.count",custody);
  const review=api.indexOf("tx.laboratoryResult.count",approved);
  const assignment=api.indexOf("tx.orderItemAnalyzerRouteEvent.create",review);
  const outbound=api.indexOf("tx.analyzerWorkOrder.create",assignment);
  assert.ok(tx>=0&&lock>tx&&custody>lock&&approved>custody&&review>approved&&assignment>review&&outbound>assignment);
  assert.ok(api.slice(assignment,outbound).includes("analyzer.bridgeDeviceKey"));
  assert.ok(api.slice(assignment,outbound).includes("codes.length === 1"));
  assert.ok(api.includes("assignmentEventId: assignment.id"));
  assert.ok(api.includes("barcodeSnapshot: ready.specimen.barcode"));
  const clear=api.indexOf("const cleared = await prisma.$transaction");
  const cancel=api.indexOf("tx.analyzerWorkOrder.updateMany",clear);
  assert.ok(clear>outbound&&cancel>clear);
  assert.ok(api.slice(cancel).includes('status: "CANCELLED"'));
});

test("Bridge command claims are authenticated and serialized on specimen custody", () => {
  const api=source("../src/app/api/integrations/analyzers/[id]/work-orders/claim/route.ts");
  assert.ok(api.includes("authenticateAnalyzerBridge(request, id)"));
  const tx=api.indexOf("await prisma.$transaction");
  const lock=api.indexOf("FROM specimens",tx);
  const eligibility=api.indexOf("analyzerWorkOrderClinicalEligibility({",lock);
  const update=api.indexOf("tx.analyzerWorkOrder.updateMany",eligibility);
  assert.ok(tx>=0&&lock>tx&&eligibility>lock&&update>eligibility);
  assert.ok(api.includes("randomBytes(32)"));
  assert.ok(api.includes('status: "CLAIMED"'));
  assert.ok(api.includes("attemptCount: { increment: 1 }"));
  assert.ok(api.includes('bridgeMustDeduplicateBy: "workOrderId"'));
});

test("lease acknowledgement cannot reuse an old claim or fake a successful send", () => {
  const api=source("../src/app/api/integrations/analyzers/[id]/work-orders/[workOrderId]/ack/route.ts");
  assert.ok(api.includes("authenticateAnalyzerBridge(request, id)"));
  assert.ok(api.includes('code !== "ACCEPTED" && code !== "RETRY" && code !== "REJECTED"'));
  assert.ok(api.includes('current.status !== "CLAIMED" || current.claimTokenHash !== claimTokenHash'));
  assert.ok(api.includes('claimTokenHash,'));
  assert.ok(api.includes('status: "CLAIMED"'));
  assert.ok(api.includes('status: nextStatus'));
  assert.ok(api.includes('error: "work_order_lease_changed"'));
  assert.ok(api.includes("analyzerRetryDelaySeconds(current.attemptCount)"));
});

test("inbound analyzer raw-message ingestion handles concurrent bridge retries without duplicate events", () => {
  const api=source("../src/app/api/integrations/analyzers/[id]/messages/route.ts");
  assert.ok(api.includes('error.code !== "P2002"'));
  assert.ok(api.includes("analyzerId_bridgeMessageId"));
  assert.ok(api.includes("stored.message"));
  assert.ok(api.includes("stored.duplicate"));
  assert.ok(api.includes("message.payloadHash !== payloadHash"));
});

test("analyzer outbound model retains immutable clinical code/barcode snapshots and assignment idempotency", () => {
  const schema=source("../prisma/schema.prisma");
  const model=schema.slice(schema.indexOf("model AnalyzerWorkOrder {"),schema.indexOf("model AnalyzerMessage {"));
  for(const evidence of ["assignmentEventId","@unique","barcodeSnapshot","testCodeSnapshot","analyzerTestCodeSnapshot","bridgeDeviceKeySnapshot","claimTokenHash","maxAttempts","leaseExpiresAt"]) {
    assert.ok(model.includes(evidence), evidence);
  }
  assert.ok(!model.includes("fullName"));
});
