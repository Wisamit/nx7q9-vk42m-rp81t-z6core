import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Send-out state changes use a conditional claim before ANY immutable event/audit write", () => {
  const src = readFileSync("src/app/api/send-outs/[id]/actions/route.ts", "utf8");
  const transaction = src.indexOf("const outcome = await prisma.$transaction(async tx =>");
  const claim = src.indexOf("tx.sendOutReferral.updateMany", transaction);
  const statusPredicate = src.indexOf("status: referral.status", claim);
  const conditionalExit = src.indexOf('if (claimed.count !== 1) return { kind: "changed" }', statusPredicate);
  const event = src.indexOf("tx.sendOutEvent.create", conditionalExit);
  const audit = src.indexOf("tx.auditEvent.create", event);
  assert.ok(transaction >= 0 && claim > transaction);
  assert.ok(statusPredicate > claim && conditionalExit > statusPredicate);
  assert.ok(event > conditionalExit && audit > event);
  assert.ok(src.includes('error: "sendout_state_changed"'));
  assert.ok(!src.includes("tx.sendOutReferral.update({ where: { id: referral.id }"));
});

test("Send-out creation rechecks order closure, specimen linkage, location and custody under row locks", () => {
  const src = readFileSync("src/app/api/send-outs/route.ts", "utf8");
  const transaction = src.indexOf("const outcome = await prisma.$transaction(async tx =>");
  const itemLock = src.indexOf("SELECT id FROM order_items", transaction);
  const freshItem = src.indexOf("const currentItem = await tx.orderItem.findFirst", itemLock);
  const duplicate = src.indexOf("const active = await tx.sendOutReferral.findFirst", freshItem);
  const specimenLock = src.indexOf("SELECT id FROM specimens", duplicate);
  const freshSpecimen = src.indexOf("const currentSpecimen = await tx.specimen.findFirst", specimenLock);
  const claim = src.indexOf("tx.specimen.updateMany", freshSpecimen);
  const referral = src.indexOf("tx.sendOutReferral.create", claim);
  assert.ok(itemLock > transaction && freshItem > itemLock && duplicate > freshItem);
  assert.ok(specimenLock > duplicate && freshSpecimen > specimenLock && claim > freshSpecimen && referral > claim);
  for (const predicate of [
    '["CANCELLED", "VERIFIED"].includes(currentItem.status)',
    '["CANCELLED", "COMPLETED"].includes(currentItem.order.status)',
    'currentSpecimen.currentBranchId !== branchId',
    'orderItems: { some: { orderItemId, status: "ACTIVE" } }',
    'organizationId: session.user.organizationId',
  ]) assert.ok(src.includes(predicate), predicate);
  assert.ok(!src.includes("id: selectedSpecimen.id,\n          status: selectedSpecimen.status"));
});
