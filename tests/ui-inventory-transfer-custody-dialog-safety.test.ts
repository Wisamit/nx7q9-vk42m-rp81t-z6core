import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read=(file:string)=>readFileSync(file,"utf8");

test("UI #265: inventory transfer creation and four custody actions require explicit protected dialogs", () => {
  const s=read("src/components/inventory-transfer-manager.tsx");
  assert.equal((s.match(/<CrudModal\b/g)||[]).length,2);
  assert.ok(s.includes('size="compact"'));
  assert.ok(s.includes('open={createOpen}'));
  assert.ok(s.includes('open={review!==null}'));
  assert.ok(s.includes('onSubmit={confirmReview}'));
  assert.ok(s.includes('onSubmit={createTransfer}'));
  for (const action of ["approve","dispatch","receive","finalize"]) {
    assert.ok(s.includes('openReview(transfer, "'+action+'")'),action);
  }
  assert.doesNotMatch(s,/(?:window\.)?(?:prompt|confirm)\s*\(/);
  assert.ok(s.includes('if(!busy)setReview(null)'));
  assert.ok(s.includes('if(!busy)setCreateOpen(false)'));
  assert.ok(s.includes('setFormError('));
  assert.ok(s.includes('role="alert"'));
  assert.ok(s.includes('if (busy) return;'));
});

test("UI #265: receipt quantities are snapshotted for review and original stock/approval protocol remains unchanged", () => {
  const s=read("src/components/inventory-transfer-manager.tsx");
  assert.ok(s.includes('const remaining = Math.max(0, dispatched - received)'));
  assert.ok(s.includes('receiveQty[line.id] === undefined ? remaining.toString() : receiveQty[line.id]'));
  assert.ok(s.includes('receivedQty: review.items'));
  assert.ok(s.includes('finalize:action==="finalize"'));
  assert.ok(s.includes('sourceBranchId,'));
  assert.ok(s.includes('destinationBranchId,'));
  assert.ok(s.includes('lotId: line.lotId, requestedQty: line.requestedQty'));
  assert.ok(s.includes('transfer.status !== "DRAFT" || !transfer.canSourceAct'));
  assert.ok(s.includes('transfer.status !== "APPROVED" || !transfer.canSourceAct'));
  assert.ok(s.includes('!transfer.canDestinationAct'));
  assert.ok(s.includes('setReceiveQty({})'));
  assert.ok(s.includes('setReview(null)'));
  assert.ok(s.includes('router.refresh()'));
});

test("UI #265: custody logic is implemented and audited by existing branch-scope APIs, not React", () => {
  for(const path of [
    "src/app/api/inventory/transfers/route.ts",
    "src/app/api/inventory/transfers/[id]/approve/route.ts",
    "src/app/api/inventory/transfers/[id]/dispatch/route.ts",
    "src/app/api/inventory/transfers/[id]/receive/route.ts",
  ]) {
    const s=read(path);
    assert.ok(s.includes("organizationId"),path);
    assert.ok(s.includes("auditEvent"),path);
  }
});
