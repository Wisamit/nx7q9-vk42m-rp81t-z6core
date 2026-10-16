import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ui = readFileSync("src/components/validation-hold-panel.tsx","utf8");
const api = readFileSync("src/app/api/results/[id]/holds/[eventId]/route.ts","utf8");

test("UI #265: blocking hold resolution requires explicit accessible clinical review", () => {
  assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.ok(ui.includes('open={pendingHold !== null}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('if (!busy) setPendingHoldId(null)'));
  assert.ok(ui.includes('pendingHold && <form className="catalog-form"'));
  assert.ok(ui.includes('required />'));
  assert.ok(ui.includes('maxLength={4000}'));
  assert.ok(ui.includes('role="alert"'));
  assert.ok(ui.includes('reviewNote.trim()'));
  assert.doesNotMatch(ui, /window\.prompt|window\.confirm/);
  assert.ok(ui.includes('event.status !== "ACTIVE"'));
  assert.ok(ui.includes('event.severity !== "BLOCK"'));
  assert.ok(ui.includes('current.status !== "ACTIVE"'));
  assert.ok(ui.includes('current.severity !== "BLOCK"'));
  assert.ok(ui.includes("does NOT automatically release a result."));
});

test("UI #265: hold response remains isolated by tenant, branch, department and audited status", () => {
  assert.ok(ui.includes('action: "RESOLVE", note'));
  assert.ok(ui.includes('if (!response.ok)'));
  assert.ok(ui.includes('setError('));
  assert.ok(ui.includes('catch {'));
  assert.ok(ui.includes('finally {'));
  assert.ok(ui.includes('router.refresh()'));
  for (const check of [
    "review_note_required", "organizationId: session.user.organizationId",
    "canAccessBranch(session", "canAccessDepartment(session",
    'status: "RESOLVED"', 'action: "VALIDATION_HOLD_RESOLVED"',
    "tx.auditEvent.create",
  ]) assert.ok(api.includes(check), "Missing server-side safety guard: " + check);
});
