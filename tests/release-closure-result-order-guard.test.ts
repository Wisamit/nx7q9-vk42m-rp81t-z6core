import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");
const guard = read("src/lib/result-order-state.ts");
const entry = read("src/app/api/results/route.ts");
const technical = read("src/app/api/results/[id]/verify/route.ts");
const medical = read("src/app/api/results/[id]/medical-validate/route.ts");
const release = read("src/app/api/results/[id]/release/route.ts");

test("One canonical lock guard serializes order -> item and rejects cancelled or closed stages", () => {
  const order = guard.indexOf("SELECT status FROM orders");
  const item = guard.indexOf("SELECT status FROM order_items", order);
  const cancelled = guard.indexOf('orderStatus === "CANCELLED" || itemStatus === "CANCELLED"', item);
  assert.ok(order >= 0 && item > order && cancelled > item);
  assert.ok(guard.includes("FOR UPDATE"));
  assert.ok(guard.includes('input.mode === "ENTRY"'));
  assert.ok(guard.includes('input.mode === "REVIEW"'));
  assert.ok(guard.includes('input.mode === "RELEASE"'));
  assert.ok(guard.includes('itemStatus !== "VERIFIED"'));
  assert.ok(guard.includes('["IN_PROGRESS", "COMPLETED"].includes(orderStatus)'));
});

test("Result entry locks current order/item before specimen and values", () => {
  const tx = entry.indexOf("const saved = await prisma.$transaction(async (tx) =>");
  const guardCall = entry.indexOf("await lockResultOrderState(tx", tx);
  const specimen = entry.indexOf("tx.specimen.updateMany", guardCall);
  const result = entry.indexOf("tx.laboratoryResult.updateMany", specimen);
  assert.ok(tx>=0 && guardCall>tx && specimen>guardCall && result>specimen);
  assert.ok(entry.includes('mode: "ENTRY"'));
  assert.ok(entry.includes('error: "order_or_test_not_open_for_results"'));
  assert.ok(entry.includes("const promoted = await tx.labOrder.updateMany"));
  assert.ok(entry.includes('fromStatus: currentOrderStatus as "REGISTERED" | "COLLECTED"'));
  assert.ok(!entry.includes('if (["REGISTERED", "COLLECTED"].includes(orderItem.order.status))'));
});

test("Both medical outcomes and technical verification lock same canonical states first", () => {
  const techTx = technical.indexOf("const updated = await prisma.$transaction(async (tx) =>");
  const techGuard = technical.indexOf("await lockResultOrderState(tx", techTx);
  const techSpecimen = technical.indexOf("SELECT id, status, current_branch_id FROM specimens", techGuard);
  assert.ok(techGuard>techTx && techSpecimen>techGuard);
  assert.ok(technical.includes('mode: "REVIEW"'));
  assert.ok(technical.includes('if (remaining === 0 && freshOrderStatus !== "COMPLETED")'));
  assert.ok(!technical.includes('if (remaining === 0 && result.orderItem.order.status !== "COMPLETED")'));
  for(const phrase of ["const returned = await prisma.$transaction", "const validated = await prisma.$transaction"]) {
    const at = medical.indexOf(phrase);
    const locked = medical.indexOf("await lockResultOrderState(tx", at);
    const specimen = medical.indexOf("SELECT id, status, current_branch_id FROM specimens",locked);
    assert.ok(at >= 0 && locked > at && specimen > locked);
  }
  assert.equal((medical.match(/mode: "REVIEW"/g)||[]).length,2);
  assert.ok(medical.includes("const advanced = await tx.labOrder.updateMany"));
  assert.ok(medical.includes('error: "order_or_test_not_open_for_results"'));
});

test("Report release refuses closed order before specimen and immutable version creation", () => {
  const tx = release.indexOf("const released = await prisma.$transaction(async (tx) =>");
  const guardCall = release.indexOf("await lockResultOrderState(tx",tx);
  const specimen = release.indexOf("SELECT DISTINCT s.id",guardCall);
  const snapshot = release.indexOf("buildDiagnosticReportSnapshot(tx",specimen);
  assert.ok(tx>=0 && guardCall>tx && specimen>guardCall && snapshot>specimen);
  assert.ok(release.includes('mode: "RELEASE"'));
  assert.ok(release.includes('error: "order_or_test_not_open_for_results"'));
});

test("Bilingual individual and bulk result editors explain closed-order conflicts", () => {
  const individual=read("src/components/result-entry-form.tsx");
  const bulk=read("src/components/bulk-result-entry.tsx");
  assert.ok(individual.includes('body.error === "order_or_test_not_open_for_results"'));
  assert.ok(bulk.includes('body.error === "order_or_test_not_open_for_results"'));
  assert.ok(individual.includes("router.refresh()"));
});
