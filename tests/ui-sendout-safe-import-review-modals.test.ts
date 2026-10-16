import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

test("UI #265: five governed send-out actions use one exact-referral review dialog", () => {
  const ui = read("src/components/send-out-manager.tsx");
  assert.equal((ui.match(/<CrudModal\b/g) || []).length, 3);
  assert.equal((ui.match(/<form\b/g) || []).length, 3);
  for (const action of ["DISPATCH", "RECEIVE_RESULT", "VERIFY", "COMPLETE", "CANCEL"]) {
    assert.ok(ui.includes('reviewAction(referral.id, "' + action + '")'),
      "Missing explicit action review: " + action);
    assert.ok(ui.includes('action === "' + action + '"'),
      "Missing server-payload/state authorization for " + action);
  }
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={confirmReview}'));
  assert.ok(ui.includes("current.specimenBarcode"));
  assert.ok(ui.includes("current.laboratoryName"));
  assert.ok(ui.includes("current.patientName"));
  assert.ok(ui.includes('name="externalAccession"'));
  assert.ok(ui.includes('name="trackingReference"'));
  assert.ok(ui.includes('name="note" required rows={3}'));
  assert.ok(ui.includes('referral.status === "RESULT_RECEIVED" && canVerify'));
  assert.ok(ui.includes('referral.status === "VERIFIED" && canVerify'));
  assert.ok(ui.includes('body: JSON.stringify({ action, ...payload })'));
  assert.ok(ui.includes('setActionError('));
  assert.ok(ui.includes('if (!busy) setReview(null)'));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);

  const api = read("src/app/api/send-outs/[id]/actions/route.ts");
  assert.ok(api.includes("requirePermission"));
  assert.ok(api.includes("auditEvent.create"));
});

test("UI #265: governed valid-only master import cannot silently include warned legacy rows or clinical reference intervals", () => {
  const ui = read("src/components/safe-import-button.tsx");
  assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={commit}'));
  assert.ok(ui.includes('open={open}'));
  assert.ok(ui.includes('method: "POST"'));
  assert.ok(ui.includes("WARNING/duplicate/generated-code rows remain excluded"));
  assert.ok(ui.includes("Reference intervals are deferred for separate clinical review"));
  assert.ok(ui.includes("if (!response.ok)"));
  assert.ok(ui.includes("catch {"));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);

  const api = read("src/app/api/catalog/imports/[id]/commit/route.ts");
  assert.ok(api.includes("requirePermission"));
  assert.ok(api.includes("auditEvent.create"));
});
