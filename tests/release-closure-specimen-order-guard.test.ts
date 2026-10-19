import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { requireActiveSpecimenOrder, SpecimenOrderNoLongerActive } from "../src/lib/specimen-order-activity.ts";

const reception = readFileSync("src/app/api/specimens/[id]/actions/route.ts", "utf8");
const volume = readFileSync("src/app/api/specimens/[id]/volume-reconcile/route.ts", "utf8");
const ui = readFileSync("src/components/specimen-actions.tsx", "utf8");

test("Active specimen order gate accepts only active workflow statuses and rejects missing/closed", async () => {
  for (const status of ["REGISTERED", "COLLECTED", "IN_PROGRESS"]) {
    const tx = { $queryRaw: async () => [{ status }] } as never;
    await assert.doesNotReject(() => requireActiveSpecimenOrder(tx, "org", "order"));
  }
  for (const status of ["CANCELLED", "COMPLETED", "DRAFT", "UNKNOWN"]) {
    const tx = { $queryRaw: async () => [{ status }] } as never;
    await assert.rejects(() => requireActiveSpecimenOrder(tx, "org", "order"), SpecimenOrderNoLongerActive);
  }
  await assert.rejects(() => requireActiveSpecimenOrder(
    { $queryRaw: async () => [] } as never, "org", "order"), SpecimenOrderNoLongerActive);
});

test("Failed specimen reception and quarantine guard live order before physical or audit mutations", () => {
  const quarantine = reception.indexOf("const quarantined = await prisma.$transaction");
  const quarantineLock = reception.indexOf("await requireActiveSpecimenOrder(tx", quarantine);
  const quarantineClaim = reception.indexOf("const claimed = await tx.specimen.updateMany", quarantineLock);
  const quarantineAudit = reception.indexOf("SPECIMEN_RECEPTION_QUARANTINED", quarantineClaim);
  const receive = reception.indexOf("const result = await prisma.$transaction", quarantineAudit);
  const receiveLock = reception.indexOf("await requireActiveSpecimenOrder(tx", receive);
  const receiveClaim = reception.indexOf("const changed = await tx.specimen.updateMany", receiveLock);
  const assessment = reception.indexOf("tx.specimenReceptionAssessment.create", receiveClaim);
  assert.ok(quarantine > 0 && quarantineLock > quarantine && quarantineClaim > quarantineLock);
  assert.ok(quarantineAudit > quarantineClaim && receive > quarantineAudit);
  assert.ok(receiveLock > receive && receiveClaim > receiveLock && assessment > receiveClaim);
  assert.ok(reception.includes('error: "specimen_order_not_active"'));
  assert.equal((reception.match(/order: \{ status: \{ notIn: \["CANCELLED", "COMPLETED"\] \} \}/g) || []).length, 2);
});

test("Volume reconciliation locks canonical open order before modifying material balance", () => {
  const txn = volume.indexOf("result = await prisma.$transaction");
  const locked = volume.indexOf("await requireActiveSpecimenOrder(tx", txn);
  const mutate = volume.indexOf("const changed = await tx.specimen.updateMany", locked);
  const usageCheck = volume.indexOf("tx.specimenUsageEvent.aggregate", mutate);
  assert.ok(txn >= 0 && locked > txn && mutate > locked && usageCheck > mutate);
  assert.ok(volume.includes('error: "specimen_order_not_active"'));
  assert.ok(volume.includes('order: { status: { notIn: ["CANCELLED", "COMPLETED"] } }'));
  assert.ok(volume.includes("reconciliationUsageFloorError"));
});

test("Specimen reception shows errors visually as errors in Arabic and English", () => {
  assert.ok(ui.includes("specimen_order_not_active: tr("));
  assert.ok(ui.includes("لم يُسجل استلام العينة"));
  assert.ok(ui.includes('messageIsError ? "form-error" : "form-success"'));
  assert.ok(ui.includes('role={messageIsError ? "alert" : "status"}'));
  assert.ok(ui.includes("if (response.status === 409) router.refresh()"));
});

test("Volume reconciliation UI explains rejected actions without a success banner", () => {
  const volumeUi = readFileSync("src/components/specimen-aliquot-manager.tsx", "utf8");
  assert.ok(volumeUi.includes("specimen_order_not_active: tr("));
  assert.ok(volumeUi.includes("لم يتغير حجم العينة"));
  assert.ok(volumeUi.includes('messageIsError ? "form-error" : "form-success"'));
  assert.ok(volumeUi.includes("if (response.status === 409) router.refresh()"));
});
