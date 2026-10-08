import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("disposal is rejected-only, branch-authorized and has a mandatory reason", () => {
  const route = readFileSync(new URL("../src/app/api/specimens/[id]/dispose/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes('requirePermission("specimens.reject")'));
  assert.ok(route.includes('error: "disposal_reason_required"'));
  assert.ok(route.includes('specimen.status !== "REJECTED"'));
  assert.ok(route.includes("canAccessBranch(session, specimen.currentBranchId)"));
});

test("disposal is atomic and preserves clinical and custody history", () => {
  const route = readFileSync(new URL("../src/app/api/specimens/[id]/dispose/route.ts", import.meta.url), "utf8");
  assert.ok(route.includes('status: "REJECTED",\n        currentBranchId: specimen.currentBranchId'));
  assert.ok(route.includes('preanalyticalVersion: specimen.preanalyticalVersion'));
  assert.ok(route.includes('const remainingChildren = await tx.specimen.count'));
  assert.ok(route.includes('eventType: "DISPOSED"'));
  assert.ok(route.includes('action: "SPECIMEN_DISPOSED"'));
  assert.ok(route.includes('previousStorageLocation: specimen.storageLocation'));
  assert.ok(!route.includes("specimen.delete"));
});

test("bilingual specimen screen exposes disposal only for rejected specimens", () => {
  const ui = readFileSync(new URL("../src/components/specimen-actions.tsx", import.meta.url), "utf8");
  assert.ok(ui.includes('canReject && status === "REJECTED"'));
  assert.ok(ui.includes('setMode("DISPOSE")'));
  assert.ok(ui.includes("disposalReason"));
  assert.ok(ui.includes("التخلص من العينة المرفوضة"));
  assert.ok(ui.includes('/dispose'));
});
