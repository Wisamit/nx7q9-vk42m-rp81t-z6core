import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(path:string)=>readFileSync(path,"utf8");
const dialog=read("src/components/legacy-evidence-review-dialog.tsx");
const coverage=read("src/components/legacy-source-coverage-review.tsx");
const specialty=read("src/components/legacy-specialty-evidence-review.tsx");

test("both Access evidence uploads require explicit compact modal confirmation, not file-selection POST",()=>{
  assert.equal((dialog.match(/<CrudModal\b/g)||[]).length,1);
  assert.ok(dialog.includes('size="compact" protectUnsavedChanges'));
  assert.ok(dialog.includes('const fileId = useId()'));
  assert.ok(dialog.includes('const tableId = useId()'));
  assert.ok(dialog.includes('htmlFor={fileId}'));
  assert.ok(dialog.includes('htmlFor={tableId}'));
  assert.ok(dialog.includes('setFile(event.currentTarget.files?.[0] ?? null)'));
  assert.ok(dialog.includes('onClick={() => void submitEvidence()}'));
  assert.ok(dialog.includes('const ok = await onReview(file, selectedTable)'));
  assert.ok(dialog.includes('if (ok) {'));
  assert.ok(dialog.includes('submitting.current = true'));
  assert.ok(dialog.includes('submitting.current = false'));
  assert.ok(dialog.includes('if (busy || submitting.current) return'));
  assert.ok(dialog.includes('disabled={busy || !file || Boolean(sourceTables && !selectedTable)}'));
  assert.ok(dialog.includes('file.size > maxBytes'));
  assert.ok(dialog.includes('file.size === 0'));
  assert.ok(dialog.includes('file.name.toLowerCase().endsWith(".json")'));
  assert.ok(dialog.includes('File selection does not upload anything'));
  assert.ok(dialog.includes('اختيار الملف لا يرفع أي بيانات'));
  assert.ok(dialog.includes('role="alert"'));
  assert.doesNotMatch(dialog,/onChange=\{[^}]*onReview\(/);
  assert.doesNotMatch(dialog,/\b(?:window\.)?(?:confirm|prompt)\s*\(/);
  const modal=read("src/components/crud-modal.tsx");
  assert.ok(modal.includes('aria-modal="true"'));
  assert.ok(modal.includes('onFocusIn'));
  assert.ok(modal.includes('protectUnsavedChanges'));
  assert.ok(read("src/app/globals.css").includes('.crud-modal-compact{width:min(33.333vw,520px)'));
});

test("coverage audit reviews only deidentified source metadata with never-certified gates",()=>{
  assert.ok(coverage.includes('<LegacyEvidenceReviewDialog'));
  assert.ok(coverage.includes('maxBytes={MAX_BYTES}'));
  assert.ok(coverage.includes('const MAX_BYTES = 64 * 1024'));
  assert.ok(coverage.includes('onReview={file => review(file)}'));
  assert.ok(coverage.includes('body:file,cache:"no-store"'));
  assert.ok(coverage.includes('parsed.status!=="REVIEW_ONLY"'));
  for(const field of ['rowParityCertified','clinicalApproved','financialApproved',
    'cutoverApproved','sourceIndependentlyVerified']) {
    assert.ok(coverage.includes('parsed.'+field+'!==false'),field);
  }
  assert.ok(coverage.includes('Array.isArray(parsed.coverage)'));
  assert.ok(coverage.includes('const [result,setResult]'));
  assert.ok(coverage.includes('return true'));
  assert.ok(coverage.includes('return false'));
  assert.ok(coverage.includes('setLoading(false)'));
  assert.doesNotMatch(coverage,/<input\s+ref=\{input\}.*type="file"/);
  const api=read("src/app/api/catalog/legacy-source-coverage/route.ts");
  for(const invariant of [
    'source_coverage_permissions_required','organization_catalog_scope_required',
    'source_coverage_scope_revoked','rowParityCertified:false',
    'clinicalApproved:false','financialApproved:false','cutoverApproved:false',
    'LEGACY_SOURCE_COVERAGE_REVIEWED','liveWrites:false',
  ]) assert.ok(api.includes(invariant),invariant);
});

test("specialty evidence requires exact table selection and explicit click, never automatically imports ranges",()=>{
  assert.ok(specialty.includes('<LegacyEvidenceReviewDialog'));
  assert.ok(specialty.includes('sourceTables={LEGACY_TABLES}'));
  assert.ok(specialty.includes('onReview={reviewEvidence}'));
  assert.ok(specialty.includes('const MAX_BYTES=6*1024*1024'));
  assert.ok(specialty.includes('if(!LEGACY_TABLES.some(table=>table===selectedTable))'));
  assert.ok(specialty.includes('JSON.parse(await file.text())'));
  assert.ok(specialty.includes('body:JSON.stringify({testId,evidence,selectedTable})'));
  assert.ok(specialty.includes('result.selectedTable!==selectedTable'));
  for(const field of ['clinicalMappingConfirmed','sourceSnapshotVerified',
    'layoutApplied','referenceIntervalsImported']) {
    assert.ok(specialty.includes('result.'+field+'!==false'),field);
  }
  assert.ok(specialty.includes('Array.isArray(result.tables)'));
  assert.ok(specialty.includes('setBusy(false)'));
  assert.ok(specialty.includes('return true'));
  assert.ok(specialty.includes('return false'));
  assert.doesNotMatch(specialty,/<input\s+ref=\{input\}.*type="file"/);
  const api=read("src/app/api/catalog/legacy-specialty-evidence/route.ts");
  for(const rule of ['requirePermission("catalog.manage")','resolveClinicalImportScope',
    'clinicalImportTestWhere','parseSpecialtyEvidence','buildSelectedSpecialtyEvidenceReview',
    'status:"review_only"','"No ranges, source observation values, units or specimen methods are returned or saved."']) {
    assert.ok(api.includes(rule),rule);
  }
});

test("evidence review remains an unresolved qualified signoff, not database migration certification",()=>{
  const doc=read("docs/UI_LEGACY_SOURCE_EVIDENCE_MODAL_CLOSURE.md");
  for(const required of ["Issue #265 OPEN","Issue #250 NO_GO","NOT_EXECUTED",
    "source coverage","specialty","audit","not proof"]) assert.ok(doc.includes(required),required);
});
