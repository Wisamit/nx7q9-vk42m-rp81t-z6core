import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("transfer receipt discrepancy requires an explicit type, reason and active manifest lock", () => {
  const source = readFileSync(new URL("../src/app/api/transfers/[id]/actions/route.ts", import.meta.url),"utf8");
  const entry = source.indexOf('if (body.action === "REPORT_EXCEPTION")');
  const lock = source.indexOf("FROM specimen_transfer_manifests",entry);
  const claim = source.indexOf("await tx.specimenTransferItem.updateMany",lock);
  const event = source.indexOf("await tx.specimenEvent.create",claim);
  const audit = source.indexOf('action: "TRANSFER_SPECIMEN_RECEIPT_EXCEPTION"',event);
  assert.ok(entry > 0 && lock > entry && claim > lock && event > claim && audit > event);
  assert.ok(source.slice(entry,lock).includes("transfer_exception_type_and_reason_required"));
  assert.ok(source.slice(lock,claim).includes("FOR UPDATE"));
  assert.ok(source.slice(claim,event).includes('status: "EXCEPTION"'));
});

test("missing material does not claim destination custody, but damaged material is quarantined", () => {
  const source = readFileSync(new URL("../src/app/api/transfers/[id]/actions/route.ts", import.meta.url),"utf8");
  const branch = source.slice(source.indexOf('if (body.action === "REPORT_EXCEPTION")'), source.indexOf("const receivedAt = new Date();"));
  assert.ok(branch.includes('exceptionType === "MISSING"'));
  assert.ok(branch.includes("const stillInTransit = await tx.specimen.count"));
  assert.ok(branch.includes('status: "IN_TRANSIT"'));
  assert.ok(branch.includes('status: "QUARANTINED"'));
  assert.ok(branch.includes("currentBranchId: manifest.destinationBranchId"));
  assert.ok(branch.includes("preanalyticalVersion: item.specimen.preanalyticalVersion"));
  assert.ok(branch.includes("physicalCustodyAccepted: exceptionType !== \"MISSING\""));
});

test("bilingual manifest UI supports exception reporting and displays retained reason", () => {
  const ui = readFileSync(new URL("../src/components/transfer-manager.tsx",import.meta.url),"utf8");
  assert.ok(ui.includes('action: "REPORT_EXCEPTION"'));
  assert.ok(ui.includes('value="MISSING"'));
  assert.ok(ui.includes('value="DAMAGED"'));
  assert.ok(ui.includes("item.exceptionText"));
  assert.ok(ui.includes("تسجيل مشكلة / حجز العينة"));
});
