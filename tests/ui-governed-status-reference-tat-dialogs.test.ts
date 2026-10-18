import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (name: string) => readFileSync("src/components/" + name + ".tsx", "utf8");
const reference = read("reference-interval-governance-actions");
const tat = read("tat-escalation-acknowledge");
const users = read("user-management");
const roles = read("role-management");

test("reference interval approval and retirement require explicit clinical review instead of browser prompts", () => {
  assert.match(reference, /import \{ CrudModal \} from "@\/components\/crud-modal"/);
  assert.match(reference, /open=\{reviewAction !== null\}/);
  assert.match(reference, /onSubmit=\{confirmReview\}/);
  assert.match(reference, /openReview\("APPROVE"\)/);
  assert.match(reference, /openReview\("RETIRE"\)/);
  assert.match(reference, /approvalStatus !== "DRAFT"/);
  assert.match(reference, /approvalStatus !== "APPROVED"/);
  assert.match(reference, /inFlight\.current = true/);
  assert.match(reference, /inFlight\.current = false/);
  assert.match(reference, /body\.error === "approved_reference_interval_overlap"/);
  assert.match(reference, /role="alert"/);
  assert.match(reference, /previously released|released reports retain historical snapshots/i);
  assert.match(reference, /size="compact"/);
  assert.doesNotMatch(reference, /\b(?:prompt|confirm)\s*\(/);
  assert.doesNotMatch(reference, /onClick=\{\(\) => void (?:act|confirmReview)\(/);
  assert.match(readFileSync("src/app/api/catalog/reference-intervals/route.ts", "utf8"),
    /approved_reference_interval_overlap/);
});

test("TAT acknowledgement is a deliberate optional-note dialog, not an automatic event on button click", () => {
  assert.match(tat, /open=\{open\}/);
  assert.match(tat, /onSubmit=\{acknowledge\}/);
  assert.match(tat, /setOpen\(true\)/);
  assert.match(tat, /setOpen\(false\)/);
  assert.match(tat, /inFlight\.current/);
  assert.match(tat, /JSON\.stringify\(\{ note: note\.trim\(\) \}\)/);
  assert.match(tat, /maxLength=\{1000\}/);
  assert.match(tat, /does not resolve an overdue test or release a clinical result/);
  assert.match(tat, /role="alert"/);
  assert.match(tat, /size="compact"/);
  assert.doesNotMatch(tat, /\b(?:prompt|confirm)\s*\(/);
});

test("staff and role status mutations cannot be sent from table buttons without a focused review", () => {
  for (const source of [users, roles]) {
    assert.match(source, /open=\{statusReview !== null\}/);
    assert.match(source, /size="compact"/);
    assert.match(source, /crud-modal-actions form-span/);
    assert.match(source, /tr\("Cancel", "إلغاء"\)/);
    assert.match(source, /tr\("Confirm status change", "تأكيد تغيير الحالة"\)/);
    assert.match(source, /role="alert"/);
    assert.match(source, /inFlight\.current = true/);
    assert.match(source, /inFlight\.current = false/);
    assert.doesNotMatch(source, /onClick=\{\(\) => void (?:setStatus|toggleRole)\(/);
  }
  assert.match(users, /onSubmit=\{confirmStatus\}/);
  assert.match(users, /setStatusReview\(\{ user, status: "SUSPENDED" \}\)/);
  assert.match(users, /setStatusReview\(\{ user, status: "ACTIVE" \}\)/);
  assert.match(users, /latest\.status !== user\.status/);
  assert.match(users, /last_system_admin/);
  assert.match(users, /currentUserId/);
  assert.match(roles, /onSubmit=\{confirmRoleStatus\}/);
  assert.match(roles, /setStatusReview\(role\)/);
  assert.match(roles, /role\.isSystem/);
  assert.match(roles, /latest\.isSystem/);
  assert.match(roles, /role\.userCount/);
});

test("the unchanged modal foundation preserves portal, focus, and unsaved-change handling", () => {
  const modal = read("crud-modal");
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(modal, /createPortal\(/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /onFocusIn/);
  assert.match(modal, /protectUnsavedChanges/);
  assert.match(css, /\.crud-modal-compact\{width:min\(33\.333vw,520px\)/);
});
