import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const ui = readFileSync("src/components/transfer-manager.tsx", "utf8");
const server = readFileSync("src/app/api/transfers/[id]/actions/route.ts", "utf8");

test("UI #265: create and dispatch use explicit barcode-level compact custody dialogs", () => {
  assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.equal((ui.match(/<CrudModal\b/g) || []).length, 2);
  assert.ok(ui.includes('open={createOpen}'));
  assert.ok(ui.includes('open={dispatchReviewId !== null}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('createOpen && <form className="catalog-form" onSubmit={createManifest}'));
  assert.ok(ui.includes('dispatchReviewId && <form className="catalog-form" onSubmit={confirmDispatch}'));
  assert.ok(ui.includes('selected.items.map(item =>'));
  assert.ok(ui.includes('item.barcodeSnapshot'));
  assert.ok(ui.includes('manifest.status !== "DRAFT"'));
  assert.ok(ui.includes('if (!busy) setDispatchReviewId(null)'));
  assert.ok(!/\bconfirm\s*\(/.test(ui));
});

test("UI #265: branch custody, exceptions and actual scanned-barcode matching remain governed server actions", () => {
  for (const value of [
    "sourceBranchId,", "destinationBranchId,", "specimenIds: selectedSpecimens",
    '"DISPATCH"', '"RECEIVE_ITEM"', '"REPORT_EXCEPTION"',
    'barcode, exceptionType, exceptionText',
    'body.manifest.manifestNumber',
    'setDispatchReviewId(null)',
    'router.refresh()',
    'finally {',
  ]) assert.ok(ui.includes(value), "Lost inter-branch custody rule: " + value);
  assert.ok(ui.includes('receiveBarcodes[manifest.id]'));
  assert.ok(ui.includes('onKeyDown={(e) => { if (e.key === "Enter")'));
  assert.ok(ui.includes('reportException(manifest.id)'));
  assert.ok(server.includes("requirePermission"));
  assert.ok(server.includes("auditEvent"));
});
