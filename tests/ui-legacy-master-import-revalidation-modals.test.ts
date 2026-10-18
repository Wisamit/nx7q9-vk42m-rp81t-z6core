import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path,"utf8");
const composer = read("src/components/legacy-master-data-import.tsx");
const revalidation = read("src/components/revalidate-import-button.tsx");

test("legacy master CSV composition moves out of direct page and into one-third compact modal", () => {
  assert.equal((composer.match(/<CrudModal\b/g) || []).length, 2);
  assert.ok(composer.includes('open={editorOpen} onClose={dismissEditor} size="compact"'));
  assert.ok(composer.includes('open={commitOpen && preview !== null && preview.conflicts.length === 0}'));
  assert.ok(composer.includes('onClick={() => { setMessage(""); setEditorOpen(true); }}'));
  assert.ok(composer.includes('{editorOpen && <div className="catalog-form">'));
  assert.ok(composer.includes('Closing an unsaved editor discards its CSV draft.'));
  assert.ok(composer.includes('setCsv("");'));
  assert.ok(composer.includes('setSourceName("");'));
  assert.ok(composer.includes('if (mode === "PREVIEW" && !editorOpen) return'));
  assert.ok(composer.includes('setEditorOpen(false);'));
  assert.ok(composer.includes('Preview — nothing has been saved'));
  assert.ok(composer.includes('preview.rows.map(row =>'));
  assert.ok(composer.includes('preview.conflicts.length ? <p'));
  assert.ok(composer.includes('onClick={() => { setConfirmed(false); setCommitOpen(true); }}'));
  assert.ok(composer.includes('onClick={() => void send("APPLY")}'));
  assert.ok(composer.includes('preview.eligible === 0'));
  assert.ok(composer.includes('checked={confirmed}'));
  assert.ok(composer.includes('preview?.fingerprint'));
  assert.ok(composer.includes('CREATE_CLIENT_MASTERS_ONLY_NO_CONTRACTS'));
  assert.ok(composer.includes('CREATE_INACTIVE_COMMENT_TEMPLATES_ONLY'));
  assert.ok(composer.includes('CREATE_NEW_RECORDS_ONLY'));
  assert.ok(composer.includes('No contracts, prices, balances or automatic referrer linking'));
  assert.doesNotMatch(composer, /\b(?:window\.)?(?:prompt|confirm)\s*\(/);
});

test("approved legacy master import retains server fingerprint and clear network partial-commit behavior", () => {
  assert.ok(composer.includes('const inFlight = useRef(false)'));
  assert.ok(composer.includes('if (working || inFlight.current) return'));
  assert.ok(composer.includes('inFlight.current = true'));
  assert.ok(composer.includes('inFlight.current = false'));
  assert.ok(composer.includes('preview.conflicts.length > 0 || !confirmed || !commitOpen'));
  assert.ok(composer.includes('mode === "APPLY") { setPreview(null); setConfirmed(false); setCommitOpen(false)'));
  assert.ok(composer.includes('Connection failed; check import status before retrying.'));
  const api = read("src/app/api/legacy/master-data-import/route.ts");
  assert.ok(api.includes('input.expectedFingerprint !== fingerprint'));
  assert.ok(api.includes('CREATE_NEW_RECORDS_ONLY'));
  assert.ok(api.includes('isolationLevel: "Serializable"'));
  assert.ok(api.includes('LEGACY_MASTER_DATA_IMPORT_COMMITTED'));
  assert.ok(api.includes('existingCodes(tx, kind, organizationId, codes)'));
});

test("legacy batch revalidation is explicit form submit, not a direct one-click POST", () => {
  assert.ok(revalidation.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.ok(revalidation.includes('<CrudModal open={open}'));
  assert.ok(revalidation.includes('size="compact"'));
  assert.ok(revalidation.includes('onSubmit={revalidate}'));
  assert.ok(revalidation.includes('Confirm revalidation'));
  assert.ok(revalidation.includes('لا يستورد فحوصاً أو يعتمد المديات المرجعية'));
  assert.ok(revalidation.includes('onClick={openReview}'));
  assert.ok(revalidation.includes('const inFlight = useRef(false)'));
  assert.ok(revalidation.includes('inFlight.current = true'));
  assert.ok(revalidation.includes('inFlight.current = false'));
  assert.ok(revalidation.includes('credentials: "same-origin"'));
  assert.ok(revalidation.includes('encodeURIComponent(batchId)'));
  assert.ok(revalidation.includes('setRetryBlocked(true)'));
  assert.ok(!revalidation.includes('setRetryBlocked(false)'), "closing/reopening must never bypass ambiguous POST fence");
  assert.ok(revalidation.includes('if (busy || inFlight.current || retryBlocked) return'));
  assert.ok(revalidation.includes('router.refresh()'));
  assert.ok(revalidation.includes('catch {'));
  assert.ok(revalidation.includes('finally {'));
  assert.ok(revalidation.includes('role="alert"'));
  assert.ok(revalidation.includes('role="status"'));
});

test("revalidate server remains authorized, unprocessed-only, owner-bound and auditable", () => {
  const api = read("src/app/api/catalog/imports/[id]/revalidate/route.ts");
  for (const evidence of [
    'requirePermission("catalog.manage")',
    'createdByUserId: session.user.id',
    'liveCatalogReviewStagingAuthority',
    'catalog_revalidate_authority_revoked',
    'sourceType !== "LEGACY_MDB_EXPORT"',
    'processed_import_batch_immutable',
    'status: { notIn: ["IMPORTED", "SKIPPED"] }',
    'isolationLevel: "RepeatableRead"',
    'CATALOG_IMPORT_REVALIDATED',
  ]) assert.ok(api.includes(evidence), evidence);
  assert.doesNotMatch(revalidation, /\b(?:window\.)?(?:prompt|confirm)\s*\(/);
  const docs = read("docs/UI_LEGACY_MASTER_IMPORT_REVALIDATION_MODALS.md");
  assert.ok(docs.includes("Issue #265 OPEN"));
  assert.ok(docs.includes("Issue #250 NO_GO"));
  assert.ok(docs.includes("NOT_EXECUTED"));
});

test("unchanged modal foundation retains focus trap, unsaved changes and compact RTL width", () => {
  const modal = read("src/components/crud-modal.tsx");
  const css = read("src/app/globals.css");
  assert.ok(modal.includes('aria-modal="true"'));
  assert.ok(modal.includes('onFocusIn'));
  assert.ok(modal.includes('protectUnsavedChanges'));
  assert.ok(modal.includes('createPortal('));
  assert.ok(css.includes(".crud-modal-compact{width:min(33.333vw,520px)"));
});
