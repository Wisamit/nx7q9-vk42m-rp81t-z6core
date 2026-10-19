import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lockActiveTransferOrders, TransferOrderNoLongerActive } from "../src/lib/transfer-order-activity.ts";

test("Transfer gate locks each unique parent order in stable sorted order", async () => {
  const locked: string[] = [];
  const tx = { $queryRaw: async (_strings: TemplateStringsArray, orderId: string) => {
    locked.push(orderId);
    return [{ status: "REGISTERED" }];
  } } as never;
  await lockActiveTransferOrders(tx, "org", ["C", "A", "B", "A", "C"]);
  assert.deepEqual(locked, ["A", "B", "C"]);
});

test("Transfer gate fails closed for completed/cancelled/missing and empty selection", async () => {
  for (const status of ["CANCELLED", "COMPLETED", "DRAFT", "UNKNOWN"]) {
    const tx = { $queryRaw: async () => [{ status }] } as never;
    await assert.rejects(() => lockActiveTransferOrders(tx, "org", ["order"]), TransferOrderNoLongerActive);
  }
  await assert.rejects(() => lockActiveTransferOrders(
    { $queryRaw: async () => [] } as never, "org", ["order"]), TransferOrderNoLongerActive);
  await assert.rejects(() => lockActiveTransferOrders(
    { $queryRaw: async () => [{ status: "REGISTERED" }] } as never, "org", []), TransferOrderNoLongerActive);
});

test("Manifest creation acquires authoritative orders before specimen locks and audit writes", () => {
  const src = readFileSync("src/app/api/transfers/route.ts", "utf8");
  const transaction = src.indexOf("const created = await prisma.$transaction");
  const guard = src.indexOf("await lockActiveTransferOrders(", transaction);
  const specimen = src.indexOf("SELECT id FROM specimens", guard);
  const create = src.indexOf("tx.specimenTransferManifest.create", specimen);
  const audit = src.indexOf("tx.auditEvent.create", create);
  assert.ok(transaction >= 0 && guard > transaction && specimen > guard && create > specimen && audit > create);
  assert.ok(src.includes("specimens.map(specimen => specimen.orderId)"));
  assert.ok(src.includes('error: "transfer_order_not_active"'));
});

test("Draft dispatch checks current order eligibility before claiming physical custody", () => {
  const src = readFileSync("src/app/api/transfers/[id]/actions/route.ts", "utf8");
  const section = src.slice(src.indexOf('if (body.action === "DISPATCH")'), src.indexOf('if (!canAccessBranch(session, manifest.destinationBranchId))'));
  const guard = section.indexOf("await lockActiveTransferOrders(");
  const manifestClaim = section.indexOf("tx.specimenTransferManifest.updateMany", guard);
  const specimenClaim = section.indexOf("tx.specimen.updateMany", manifestClaim);
  const audit = section.indexOf("TRANSFER_MANIFEST_DISPATCHED", specimenClaim);
  assert.ok(guard >= 0 && manifestClaim > guard && specimenClaim > manifestClaim && audit > specimenClaim);
  assert.ok(section.includes("manifest.items.map(item => item.specimen.orderId)"));
  assert.ok(section.includes('order: { status: { notIn: ["CANCELLED", "COMPLETED"] } }'));
  assert.ok(section.includes('error: "transfer_order_not_active"'));
});

test("Already shipped specimen receipt/exception routes retain custody regardless of later order status", () => {
  const src = readFileSync("src/app/api/transfers/[id]/actions/route.ts", "utf8");
  const receipt = src.slice(src.indexOf("if (!canAccessBranch(session, manifest.destinationBranchId))"));
  assert.ok(!receipt.includes("lockActiveTransferOrders"));
  assert.ok(receipt.includes('if (body.action === "REPORT_EXCEPTION")'));
  assert.ok(receipt.includes('const result = await prisma.$transaction'));
  assert.ok(receipt.includes('status: "IN_TRANSIT"'));
});

test("Transfer UI explains stale closed-order rejection bilingually without success styling", () => {
  const ui = readFileSync("src/components/transfer-manager.tsx", "utf8");
  assert.equal((ui.match(/body.error === "transfer_order_not_active"/g) || []).length, 2);
  assert.ok(ui.includes("لم يتم إنشاء بيان النقل"));
  assert.ok(ui.includes("لم تُرسل أي عينة"));
  assert.ok(ui.includes('messageIsError ? "form-error" : "form-success"'));
  assert.ok(ui.includes('role={messageIsError ? "alert" : "status"}'));
  assert.ok(ui.includes("if (response.status === 409) router.refresh()"));
});
