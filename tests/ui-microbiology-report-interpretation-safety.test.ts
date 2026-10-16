import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read=(path:string)=>readFileSync(path,"utf8");

test("UI #265: microbiology master data and barcode/performing-branch case creation use three guarded dialogs",()=>{
  const source=read("src/components/microbiology-manager.tsx");
  assert.equal((source.match(/<CrudModal\b/g)||[]).length,3);
  assert.equal((source.match(/<form\b/g)||[]).length,3);
  assert.ok(source.includes('editor==="ORGANISM"'));
  assert.ok(source.includes('editor==="ANTIBIOTIC"'));
  assert.ok(source.includes('open={caseReview!==null}'));
  assert.ok(source.includes('onSubmit={createCase}'));
  assert.ok(source.includes('performingBranchId:candidate.performingBranchId'));
  assert.ok(source.includes('specimenId:candidate.specimenId'));
  assert.ok(source.includes('orderItemId:candidate.orderItemId'));
  assert.ok(source.includes('candidates.some(row=>row.orderItemId===candidate.orderItemId'));
  assert.ok(source.includes('caseReview.barcode'));
  assert.ok(source.includes('size="compact"'));
  assert.ok(source.includes('if(!busy)setCaseReview(null)'));
  assert.ok(source.includes("finally"));
  assert.ok(source.includes('role="alert"'));
  for(const apiPath of [
    "src/app/api/microbiology/cases/route.ts",
    "src/app/api/microbiology/master-data/route.ts",
  ]) {
    const body=read(apiPath);
    assert.ok(body.includes("organizationId"));
    assert.ok(body.includes("auditEvent"));
  }
});

test("UI #265: report interpretation uses immutable bilingual draft and independent clinical decision modal",()=>{
  const source=read("src/components/report-interpretation-manager.tsx");
  assert.equal((source.match(/<CrudModal\b/g)||[]).length,2);
  assert.equal((source.match(/<form\b/g)||[]).length,2);
  assert.ok(source.includes('open={reviewAction!==null}'));
  assert.ok(source.includes('open={createOpen}'));
  assert.ok(source.includes('onSubmit={decide}'));
  assert.ok(source.includes('onSubmit={e=>void create(e)}'));
  assert.ok(source.includes('latest.createdBy===currentUserId'));
  assert.ok(source.includes('latest.status!=="DRAFT"'));
  assert.ok(source.includes('id:latest.id,expectedFingerprint:latest.fingerprint'));
  assert.ok(source.includes('"APPROVE_EXACT_BILINGUAL_REPORT_INTERPRETATION"'));
  assert.ok(source.includes('minLength={10} maxLength={1000}'));
  assert.ok(source.includes('dir="ltr"')&&source.includes('dir="rtl"'));
  assert.ok(source.includes('setReviewAction(null)'));
  assert.doesNotMatch(source,/(?:window\.)?(?:confirm|prompt)\s*\(/);
  const api=read("src/app/api/reports/interpretations/route.ts");
  assert.ok(api.includes("organizationId"));
  assert.ok(api.includes("auditEvent"));
  assert.ok(api.includes("createdByUserId"));
});
