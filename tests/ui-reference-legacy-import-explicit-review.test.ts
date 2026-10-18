import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compareReferenceImportPreview } from "../src/lib/reference-import-preview-guard.ts";

const source = (path: string) => readFileSync(path, "utf8");
const ui = source("src/components/reference-range-import-button.tsx");

test("clinical preview comparator rejects changed and malformed row counts", () => {
  const before = { total: 17, safe: 8, review: 9, generatedTestsRemaining: 2 };
  assert.equal(compareReferenceImportPreview(before, { ...before }), "same");
  for (const after of [
    { ...before, safe: 7, review: 10 },
    { ...before, generatedTestsRemaining: 3 },
    { ...before, total: 18 },
    { ...before, review: 8 },
  ]) assert.equal(compareReferenceImportPreview(before, after), "changed");
  assert.equal(compareReferenceImportPreview({ total: 0, safe: 0, review: 0 },
    { total: 0, safe: 0, review: 0, generatedTestsRemaining: 0 }), "same");
  for (const malformed of [
    null,
    { ...before, safe: 18 },
    { ...before, review: -1 },
    { ...before, safe: Number.NaN },
    { ...before, review: 1.1 },
    { ...before, total: Number.MAX_SAFE_INTEGER + 1 },
    { ...before, generatedTestsRemaining: Infinity },
  ]) assert.equal(compareReferenceImportPreview(before, malformed), "invalid");
});

test("both reference interval import and safe legacy resolution require a compact bilingual review dialog", () => {
  assert.ok(ui.includes('import { CrudModal } from "@/components/crud-modal"'));
  assert.ok(ui.includes('setReviewAction(action)'));
  assert.ok(ui.includes('openReview("RESOLVE")'));
  assert.ok(ui.includes('openReview("IMPORT")'));
  assert.ok(ui.includes('open={reviewAction !== null}'));
  assert.ok(ui.includes('size="compact"'));
  assert.ok(ui.includes('onSubmit={confirmReview}'));
  for (const field of ["reviewSnapshot.safe", "reviewSnapshot.review", "reviewSnapshot.total", "reviewSnapshot.generatedTestsRemaining"]) {
    assert.ok(ui.includes(field), field);
  }
  assert.ok(ui.includes('disabled={busy || reviewRetryBlocked'));
  assert.ok(ui.includes('setReviewAction(null)'));
  assert.ok(ui.includes('role="alert"'));
  assert.ok(ui.includes('pending independent clinical approval'));
  assert.ok(ui.includes('لا يعتمد هذا الإجراء أي مدى مرجعي'));
  assert.doesNotMatch(ui, /\b(?:window\.)?(?:confirm|prompt)\s*\(/);
  assert.doesNotMatch(ui, /onClick=\{(?:run|resolveSafeLegacy)\}/);
});

test("live no-cache preview recheck must precede each chain of mutating API calls", () => {
  const confirmStart = ui.indexOf("async function confirmReview");
  const previewRead = ui.indexOf('cache: "no-store"', confirmStart);
  const compare = ui.indexOf("compareReferenceImportPreview(snapshot, live)", confirmStart);
  const masterWrite = ui.indexOf('/commit', compare);
  const unitWrite = ui.indexOf('/prepare-units', masterWrite);
  const rangeWrite = ui.indexOf('/reference-ranges', unitWrite);
  assert.ok(confirmStart >= 0 && previewRead > confirmStart && compare > previewRead);
  assert.ok(masterWrite > compare && unitWrite > masterWrite && rangeWrite > unitWrite);
  assert.ok(ui.includes('comparison === "invalid"'));
  assert.ok(ui.includes('comparison === "changed"'));
  assert.ok(ui.includes('setReviewSnapshot(live)'));
  assert.ok(ui.includes('inFlight.current = true'));
  assert.ok(ui.includes('inFlight.current = false'));
  assert.ok(ui.includes('if (mutationStarted) setReviewRetryBlocked(true)'));
  assert.ok(ui.includes('Some changes may already have been saved'));
  assert.ok(ui.includes('catch (error)'));
  assert.ok(ui.includes('finally {'));
});

test("manual mapping cannot race an import or strand a pending spinner on network errors", () => {
  assert.ok(ui.includes('const mappingInFlight = useRef(false)'));
  assert.ok(ui.includes('inFlight.current || mappingInFlight.current || busy || resolving || reviewAction'));
  assert.ok(ui.includes('mappingInFlight.current = true'));
  assert.ok(ui.includes('mappingInFlight.current = false'));
  assert.ok(ui.includes('setMappingBusy(mapKey)'));
  assert.ok(ui.includes('setMappingBusy("")'));
  assert.ok(ui.includes('role="status"'));
  assert.ok(ui.includes('mapping may have been saved'));
});

test("server retains clinical permission and inactive range staging; no UAT signoff inferred", () => {
  const server = source("src/app/api/catalog/imports/[id]/reference-ranges/route.ts");
  const master = source("src/app/api/catalog/imports/[id]/commit/route.ts");
  assert.ok(server.includes('liveLegacyClinicalWriteScope'));
  assert.ok(server.includes('status: "INACTIVE"'));
  assert.ok(server.includes('tx.auditEvent.create'));
  assert.ok(master.includes('requirePermission'));
  assert.ok(ui.includes('router.refresh()'));
  const docs = source("docs/UI_REFERENCE_LEGACY_IMPORT_REVIEW_CLOSURE.md");
  assert.ok(docs.includes("Issue #265 OPEN"));
  assert.ok(docs.includes("NOT_EXECUTED"));
  assert.ok(docs.includes("NO_GO"));
});
