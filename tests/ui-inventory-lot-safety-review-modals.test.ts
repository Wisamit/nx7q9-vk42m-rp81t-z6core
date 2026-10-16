import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");

test("UI #265: organization-wide lot quarantine, recall and independently governed release require explicit modal", () => {
  const ui = read("src/components/inventory-lot-safety-manager.tsx");
  assert.ok(ui.includes('import {CrudModal} from "@/components/crud-modal"'));
  assert.ok(ui.includes("open={open}"));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={submit}'));
  assert.ok(ui.includes('if(!busy)setOpen(false)'));
  assert.ok(ui.includes('name') || ui.includes("reason.trim().length<20"));
  assert.ok(ui.includes('"QUARANTINE"'));
  assert.ok(ui.includes('"RECALL"'));
  assert.ok(ui.includes('"RELEASE"'));
  assert.ok(ui.includes('value={selected}'));
  assert.ok(ui.includes('value={choice}'));
  assert.ok(ui.includes('value={reason}'));
  assert.ok(ui.includes('body:JSON.stringify({lotId:current.id,action:choice,reason})'));
  assert.ok(ui.includes("setOpen(false);router.refresh()"));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);

  const api = read("src/app/api/inventory/lot-safety/route.ts");
  assert.ok(api.includes("independent_lot_release_review_required"));
  assert.ok(api.includes('INVENTORY_LOT_RECALLED'));
  assert.ok(api.includes('INVENTORY_LOT_QUARANTINED'));
  assert.ok(api.includes('tx.auditEvent.create'));
});

test("UI #265: branch physical stock isolation acknowledgement remains an attestation, not automatic clearance", () => {
  const ui = read("src/components/inventory-lot-branch-response.tsx");
  assert.equal((ui.match(/<CrudModal\b/g) || []).length, 1);
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={submit}'));
  assert.ok(ui.includes('open&&canRespond&&safetyEventId'));
  assert.ok(ui.includes('activeBranchCode'));
  assert.ok(ui.includes('"NOTICE_RECEIVED"'));
  assert.ok(ui.includes('"STOCK_ISOLATED"'));
  assert.ok(ui.includes('"ESCALATED_TO_QUALITY"'));
  assert.ok(ui.includes('note.trim().length<20'));
  assert.ok(ui.includes("if(!busy)setOpen(false)"));
  assert.ok(ui.includes('body:JSON.stringify({lotId,safetyEventId,action,note:note.trim()})'));
  assert.ok(ui.includes("not actual automated verification"));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);

  const api = read("src/app/api/inventory/lot-responses/route.ts");
  assert.ok(api.includes('INVENTORY_LOT_BRANCH_RESPONSE_RECORDED'));
  assert.ok(api.includes('tx.auditEvent.create'));
});
