import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (filename: string) => readFileSync(filename, "utf8");

test("UI #265: mapped analyzer clinical import requires guarded review dialog, not result release", () => {
  const ui = read("src/components/analyzer-clinical-import-button.tsx");
  assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal";'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={commit}'));
  assert.ok(ui.includes('open={open}'));
  assert.ok(ui.includes('body: JSON.stringify({ importIds })'));
  assert.ok(ui.includes('"/api/analyzers/imports/commit"'));
  assert.ok(ui.includes('importIds.length === 0'));
  assert.ok(ui.includes('disabled={busy || importIds.length === 0}'));
  assert.ok(ui.includes("This does not verify or release any result"));
  assert.ok(ui.includes("if (!response.ok)"));
  assert.ok(ui.includes("catch {"));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);

  const api = read("src/app/api/analyzers/imports/commit/route.ts");
  assert.ok(api.includes('requirePermission("analyzers.import")'));
  assert.ok(api.includes("canAccessBranch(session, analyzer.branchId)"));
  assert.ok(api.includes("analyzerMappingClinicallyUsable"));
  assert.ok(api.includes("specimen_analyzer_branch_mismatch"));
});

test("UI #265: new comment revisions are immutable drafts with explicit separate reviewer boundary", () => {
  const ui = read("src/components/comment-revision-editor.tsx");
  assert.equal((ui.match(/<CrudModal\b/g) || []).length, 1);
  assert.equal((ui.match(/<form\b/g) || []).length, 1);
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('open={open}'));
  assert.ok(ui.includes('onSubmit={e => void submit(e)}'));
  assert.ok(ui.includes('setOpen(false)'));
  assert.ok(ui.includes('expectedFingerprint: current.fingerprint'));
  assert.ok(ui.includes("An independent clinical reviewer"));
  assert.ok(ui.includes('nameEn, nameAr, textEn, textAr, reason'));
  assert.ok(ui.includes('role="alert"'));
  assert.ok(ui.includes('if (busy)') || ui.includes('current || busy'));
  assert.doesNotMatch(ui, /(?:window\.)?(?:prompt|confirm)\s*\(/);

  const api = read("src/app/api/clinical-rules/comments/revisions/route.ts");
  assert.ok(api.includes('requirePermission("result_comments.manage")'));
  assert.ok(api.includes('status: "INACTIVE"'));
  assert.ok(api.includes('RESULT_COMMENT_TEMPLATE_REVISION_CREATED'));
  assert.ok(api.includes('await tx.auditEvent.create'));
  assert.ok(api.includes('isolationLevel: "Serializable"'));
});
