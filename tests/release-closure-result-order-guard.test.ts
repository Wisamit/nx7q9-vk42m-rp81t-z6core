import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("Result entry rechecks current states before writes", () => {
  const s = readFileSync("src/app/api/results/route.ts", "utf8");
  const start = s.indexOf("const saved = await prisma.$transaction(async (tx) =>");
  const order = s.indexOf("SELECT status FROM orders", start);
  const item = s.indexOf("SELECT status FROM order_items", order);
  const check = s.indexOf('throw new Error("ORDER_RESULT_ENTRY_CLOSED")', item);
  const specimen = s.indexOf("tx.specimen.updateMany", check);
  const result = s.indexOf("tx.laboratoryResult.updateMany", specimen);
  assert.ok(start >= 0 && order > start && item > order &&
    check > item && specimen > check && result > specimen);
  assert.ok(s.includes('error: "order_or_test_not_open_for_results"'));
  assert.ok(s.includes('!["REGISTERED", "COLLECTED", "IN_PROGRESS"].includes(currentOrder[0].status)'));
  assert.ok(s.includes('!["ORDERED", "COLLECTED", "IN_PROGRESS", "RESULTED"].includes(currentItem[0].status)'));
});

test("Order promotion depends on the locked snapshot", () => {
  const s = readFileSync("src/app/api/results/route.ts", "utf8");
  assert.ok(s.includes('const currentOrderStatus = currentOrder[0].status'));
  assert.ok(s.includes("const promoted = await tx.labOrder.updateMany"));
  assert.ok(s.includes('if (promoted.count !== 1) throw new Error("ORDER_RESULT_ENTRY_CLOSED")'));
  assert.ok(s.includes('fromStatus: currentOrderStatus as "REGISTERED" | "COLLECTED"'));
  assert.ok(!s.includes('if (["REGISTERED", "COLLECTED"].includes(orderItem.order.status))'));
});
