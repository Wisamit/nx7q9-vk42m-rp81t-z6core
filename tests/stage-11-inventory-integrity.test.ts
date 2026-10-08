import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("transfer receiver rejects duplicate and unknown line IDs before transaction", () => {
  const route = source("../src/app/api/inventory/transfers/[id]/receive/route.ts");
  const known = route.indexOf("const knownLineIds = new Set");
  const duplicate = route.indexOf("new Set(submittedIds).size !== submittedIds.length", known);
  const transaction = route.indexOf("const received = await prisma.$transaction", duplicate);
  assert.ok(known >= 0 && duplicate > known && transaction > duplicate);
  assert.ok(route.includes('error: "invalid_or_duplicate_transfer_item"'));
});

test("transfer receiver reads latest quantities inside transaction", () => {
  const route = source("../src/app/api/inventory/transfers/[id]/receive/route.ts");
  const transaction = route.indexOf("const received = await prisma.$transaction");
  const current = route.indexOf("tx.inventoryTransferItem.findMany", transaction);
  const updated = route.indexOf("nextReceived = alreadyReceived.add(addQty)", current);
  const stock = route.indexOf("tx.branchStock.upsert", updated);
  assert.ok(transaction >= 0 && current > transaction && updated > current && stock > updated);
  assert.ok(route.includes('if (nextReceived.gt(dispatchedQty)) throw new Error("RECEIVED_EXCEEDS_DISPATCHED")'));
});

test("goods receipt aggregates repeated purchase order lines before posting", () => {
  const route = source("../src/app/api/inventory/receipts/[id]/post/route.ts");
  const tx = route.indexOf("const posted = await prisma.$transaction");
  const aggregate = route.indexOf("const increments = new Map<string, Prisma.Decimal>()", tx);
  const cap = route.indexOf("currentLine.receivedQty.add(increase).gt(currentLine.orderedQty)", aggregate);
  const inventory = route.indexOf("tx.inventoryLot.findUnique", cap);
  const once = route.indexOf("data: { receivedQty: { increment: increase } }", inventory);
  assert.ok(tx >= 0 && aggregate > tx && cap > aggregate && inventory > cap && once > inventory);
  assert.ok(route.includes('throw new Error("PO_OVER_RECEIPT")'));
  assert.ok(route.includes("currentLine.itemId !== expectedItems.get(poItemId)"));
  assert.ok(route.includes('throw new Error("PO_ITEM_MISMATCH")'));
});
