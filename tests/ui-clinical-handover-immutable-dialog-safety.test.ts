import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync("src/components/order-clinical-handover-manager.tsx", "utf8");
const api = readFileSync("src/app/api/orders/[id]/clinical-handover/route.ts", "utf8");

test("UI #265: governed order clinical handover create and correction are explicit compact dialogs", () => {
  assert.equal((src.match(/<CrudModal\b/g) || []).length, 2);
  assert.equal((src.match(/<form\b/g) || []).length, 2);
  assert.ok(src.includes('size="compact"'));
  assert.ok(src.includes('open={editorOpen}'));
  assert.ok(src.includes('setEditorOpen(true)'));
  assert.ok(src.includes('if(!busy)setEditorOpen(false)'));
  assert.ok(src.includes('onSubmit={e=>void submit(e)}'));
  assert.ok(src.includes("clientRequestId"));
  assert.ok(src.includes("setClientRequestId(crypto.randomUUID())"));
  assert.ok(src.includes("replacesNoteId"));
  assert.ok(src.includes("correctionReason:replacesNoteId?correctionReason:null"));
  assert.ok(src.includes("requiresAcknowledgement"));
  assert.ok(src.includes("setEditorOpen(false);reset()"));
  assert.doesNotMatch(src, /(?:window\.)?(?:prompt|confirm)\s*\(/);
});

test("UI #265: exact note acknowledgement and retraction require role-scoped review and reason", () => {
  assert.ok(src.includes('open={pendingAction!==null}'));
  assert.ok(src.includes('onSubmit={e=>void action(e)}'));
  assert.ok(src.includes('retractionReason.trim()'));
  assert.ok(src.includes('reason.length<10'));
  assert.ok(src.includes('minLength={10} maxLength={1000}'));
  assert.ok(src.includes('body:JSON.stringify({noteId,action:operation,reason})'));
  assert.ok(src.includes('note.status!=="ACTIVE"'));
  assert.ok(src.includes("if(!busy)setPendingAction(null)"));
  assert.ok(src.includes('setPendingAction(null)'));
  assert.ok(src.includes('role="alert"'));
  assert.ok(src.includes('note.createdByUserId!==currentUserId'));
  assert.ok(src.includes("canCorrectOthers"));
  assert.ok(src.includes('canWrite&&activeBranch'));

  assert.ok(api.includes('requirePermission("orders.view")'));
  assert.ok(api.includes('ORDER_CLINICAL_HANDOVER_ACKNOWLEDGED'));
  assert.ok(api.includes('ORDER_CLINICAL_HANDOVER_RETRACTED'));
  assert.ok(api.includes('status:"SUPERSEDED"'));
  assert.ok(api.includes('status:"RETRACTED"'));
  assert.ok(api.includes('independent_acknowledgement_required'));
  assert.ok(api.includes('isolationLevel:"Serializable"'));
});
