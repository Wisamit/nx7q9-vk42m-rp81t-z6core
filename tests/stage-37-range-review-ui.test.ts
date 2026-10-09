import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stagedRangeAgeOverlapIndex, stagedRangeAgeOverlapIssue, rangeReviewCandidate,
  stagedRangeContextIndex, stagedRangeContextIssue } from "../src/lib/catalog-range-import-reconciliation.ts";

const route = readFileSync("src/app/api/catalog/imports/[id]/ranges/reconcile/route.ts", "utf8");
const page = readFileSync("src/app/catalog/imports/[id]/page.tsx", "utf8");
const ui = readFileSync("src/components/reference-range-import-reconciliation.tsx", "utf8");
const source = (patch: Record<string,string> = {}) => ({
  testName: "HGB", unit: "g/dL", sex: "FEMALE", ageFrom: "0", ageTo: "5",
  ageUnit: "YEAR", low: "12.50", high: "17.00", normalTextEn: "", ...patch,
});

test("Stage 37 renders clinical range reconciliation only for CSV batches with clinical permission", () => {
  assert.match(page, /batch\.sourceType === "CSV_REVIEW" && entityCounts\.REFERENCE_INTERVAL > 0/);
  assert.match(page, /permissions\.has\("catalog\.reference_ranges\.manage"\) && <ReferenceRangeImportReconciliation/);
  assert.match(page, /batch\.createdByUserId !== session\.user\.id/);
  assert.match(page, /resolveClinicalImportScope/);
  assert.match(ui, /\/ranges\/reconcile/);
  assert.match(ui, /cache: "no-store"/);
  assert.match(ui, /encodeURIComponent\(batchId\)/);
  assert.doesNotMatch(ui, /method:\s*"POST"|method:\s*"PATCH"|method:\s*"DELETE"/);
  assert.doesNotMatch(ui, /\/reference-ranges\b|\/commit\b/);
});

test("Range review requires immutable read-only flags before rendering a page and bounds client memory", () => {
  assert.match(ui, /body\.liveWrites !== false/);
  assert.match(ui, /body\.clinicalActivation !== false/);
  assert.match(ui, /body\.approvalRequired !== true/);
  assert.match(ui, /body\.rows\.length > 100/);
  assert.match(ui, /setRows\(body\.rows\)/);
  assert.doesNotMatch(ui, /setRows\(current => \[\.\.\.current/);
  assert.match(ui, /loadPage\(history\[history\.length - 1\], history\.slice\(0, -1\)\)/);
  assert.match(ui, /loadPage\(nextCursor, \[\.\.\.history, cursor\]\)/);
  assert.match(ui, /row\.candidate \?/);
  assert.match(ui, /Clinical review required/);
});

test("API redacts non-reviewable CSV statuses including malformed ERROR and processed rows", () => {
  assert.match(route, /row\.status !== "VALID" && row\.status !== "WARNING"/);
  assert.match(route, /candidate: null/);
  assert.match(route, /ROW_NOT_REVIEWABLE/);
  assert.match(route, /ROW_ALREADY_PROCESSED/);
  assert.match(route, /testId: null, componentId: null, unitId: null/);
  assert.match(route, /createdByUserId: session\.user\.id/);
  assert.match(route, /clinicalImportTestWhere\(scope\)/);
  assert.match(route, /take: PAGE_SIZE \+ 1/);
  assert.match(route, /take: 20001/);
  assert.match(route, /liveWrites: false/);
  assert.match(route, /clinicalActivation: false/);
  assert.doesNotMatch(route, /referenceInterval\.(create|update)|prisma\.\$transaction/);
});

test("UI surfaced warnings remain exact-source read-only signals, not clinical approval", () => {
  const a=source(), b=source({ageFrom:"4",ageTo:"9"});
  const rows=[a,b].map(normalizedData => ({normalizedData,status:"WARNING"}));
  assert.equal(stagedRangeAgeOverlapIssue(rangeReviewCandidate(a),stagedRangeAgeOverlapIndex(rows)),
    "POTENTIAL_STAGED_AGE_WINDOW_OVERLAP");
  const duplicate=[a,source({ageFrom:"00.000",ageTo:"05.000"})].map(normalizedData => ({normalizedData,status:"WARNING"}));
  assert.equal(stagedRangeContextIssue(rangeReviewCandidate(a),stagedRangeContextIndex(duplicate)),
    "DUPLICATE_STAGED_RANGE_CONTEXT");
  assert.match(ui, /POTENTIAL_STAGED_AGE_WINDOW_OVERLAP/);
  assert.match(ui, /CONFLICTING_STAGED_RANGE_CONTEXT/);
  assert.match(ui, /DUPLICATE_STAGED_RANGE_CONTEXT/);
});
