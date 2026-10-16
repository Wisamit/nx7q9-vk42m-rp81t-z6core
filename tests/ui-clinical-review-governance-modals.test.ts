import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file: string) => readFileSync(file, "utf8");

test("Issue #265: comment approval/retirement requires an explicit fingerprint-locked bilingual clinical review", () => {
  const ui = read("src/components/comment-template-status-button.tsx");
  const api = read("src/app/api/clinical-rules/comments/route.ts");
  assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.ok(ui.includes('open={reviewOpen}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={event => void changeStatus(event)}'));
  assert.ok(ui.includes('if (!busy) setReviewOpen(false)'));
  assert.ok(ui.includes('required minLength={10} maxLength={1000}'));
  assert.ok(ui.includes('const reason = reviewReason.trim()'));
  assert.ok(ui.includes('expectedFingerprint: fingerprint'));
  assert.ok(ui.includes('APPROVE_REVISION_AND_RETIRE_PREDECESSOR'));
  assert.ok(ui.includes('APPROVE_EXACT_BILINGUAL_CLINICAL_TEXT'));
  assert.ok(ui.includes('comment_template_self_approval_forbidden'));
  assert.ok(ui.includes('comment_template_review_stale'));
  assert.ok(ui.includes('comment_template_origin_unverified'));
  assert.ok(ui.includes('pending.current = true'));
  assert.ok(ui.includes('pending.current = false'));
  assert.doesNotMatch(ui, /\b(?:prompt|confirm)\s*\(/);
  assert.ok(api.includes("expectedFingerprint"));
  assert.ok(api.includes("tx.auditEvent.create"));
  assert.ok(api.includes("creation?.actorUserId"));
  assert.ok(api.includes('reason'));
});

test("Issue #265: analyzer mapping decisions remain separately authorized with branch and unit safeguards", () => {
  const ui = read("src/components/analyzer-mapping-governance-button.tsx");
  const api = read("src/app/api/analyzers/[id]/mappings/route.ts");
  assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.ok(ui.includes('open={reviewAction !== null}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={event => void act(event)}'));
  assert.ok(ui.includes('approvalStatus !== "DRAFT" || !independent'));
  assert.ok(ui.includes('approvalStatus !== "APPROVED"'));
  assert.ok(ui.includes('const reason = action === "RETIRE" ? reviewReason.trim() : ""'));
  assert.ok(ui.includes('required rows={3} maxLength={1000}'));
  assert.ok(ui.includes('body: JSON.stringify({ id, action, reason })'));
  assert.ok(ui.includes('analyzer_mapping_self_approval_forbidden'));
  assert.ok(ui.includes('analyzer_mapping_creator_unknown'));
  assert.ok(ui.includes('analyzer_mapping_live_permission_revoked'));
  assert.ok(ui.includes('approved_analyzer_mapping_overlap'));
  assert.ok(ui.includes('analyzer_unit_code_required_for_unit_target'));
  assert.doesNotMatch(ui, /\b(?:prompt|confirm)\s*\(/);
  assert.ok(api.includes('analyzer_mapping_self_approval_forbidden'));
  assert.ok(api.includes('analyzer_mapping_live_permission_revoked'));
  assert.ok(api.includes('auditEvent.create'));
});
