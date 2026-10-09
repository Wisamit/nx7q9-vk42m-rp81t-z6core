import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/app/api/specimens/[id]/aliquots/route.ts", import.meta.url),
  "utf8",
);

test("aliquot volume consumption is conditional on a still-open order", () => {
  const transactionStart = source.indexOf("const result = await prisma.$transaction(");
  const orderLock = source.indexOf("SELECT id FROM orders", transactionStart);
  const parentUpdate = source.indexOf("const consumed = await tx.specimen.updateMany", transactionStart);
  assert.ok(transactionStart >= 0 && orderLock > transactionStart && parentUpdate > orderLock);
  assert.ok(source.includes("AND status NOT IN ('CANCELLED', 'COMPLETED')"));
  assert.ok(source.includes("status: { notIn: [\"CANCELLED\", \"COMPLETED\"] }"));
  assert.ok(source.includes("throw new AliquotOrderChanged()"));
  assert.ok(source.includes('error: "aliquot_order_not_active"'));
});

test("each explicitly assigned test is reverified with row locking before any allocation", () => {
  assert.ok(source.includes("SELECT soi.order_item_id AS orderItemId"));
  assert.ok(source.includes("INNER JOIN order_items oi ON oi.id = soi.order_item_id"));
  assert.ok(source.includes("soi.status = 'ACTIVE'"));
  assert.ok(source.includes("oi.status <> 'CANCELLED'"));
  assert.ok(source.includes("oi.order_id = ${parent.orderId}"));
  assert.ok(source.includes("Prisma.join(requestedOrderItemIds)"));
  assert.ok(source.includes("eligibleLinks.length !== requestedOrderItemIds.length"));
  assert.ok(source.indexOf("eligibleLinks.length") < source.indexOf("const consumed = await tx.specimen.updateMany"));
  assert.ok(source.includes('error: "aliquot_order_item_not_linked_to_parent"'));
});

test("selected container cannot be deactivated mid-transaction", () => {
  const lock = source.indexOf("SELECT id FROM containers");
  const consume = source.indexOf("const consumed = await tx.specimen.updateMany");
  assert.ok(lock > 0 && lock < consume);
  assert.ok(source.includes("AND organization_id = ${session.user.organizationId}"));
  assert.ok(source.includes("AND status = 'ACTIVE'"));
  assert.ok(source.includes("throw new AliquotContainerChanged()"));
  assert.ok(source.includes('error: "container_not_active"'));
});

test("aliquot child creation, volume use, clinical event and audit remain in one transaction", () => {
  const start = source.indexOf("const result = await prisma.$transaction(");
  const end = source.indexOf("}, { timeout: 30000 });", start);
  assert.ok(end > start);
  const tx = source.slice(start, end);
  for (const operation of [
    "tx.specimen.updateMany(", "tx.specimen.create(", "tx.specimenOrderItem.createMany(",
    "tx.specimenEvent.create(", "tx.specimenUsageEvent.create(", "tx.auditEvent.create(",
  ]) assert.ok(tx.includes(operation), "Missing atomic operation: " + operation);
  assert.ok(tx.includes("preanalyticalVersion: parent.preanalyticalVersion"));
  assert.ok(tx.includes('parentRelationType: "ALIQUOT"'));
});
