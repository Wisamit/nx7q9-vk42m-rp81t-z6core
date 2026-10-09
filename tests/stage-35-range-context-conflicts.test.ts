import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  rangeReviewCandidate, reconcileRangeReviewCandidate,
  stagedRangeContextIndex, stagedRangeContextIssue,
} from "../src/lib/catalog-range-import-reconciliation.ts";

const range = (patch: Record<string,string>={}) => ({
  testName:"HGB", unit:"g/dL", sex:"ANY", ageFrom:"0.0", ageTo:"18.000",
  ageUnit:"YEAR", low:"12.500000", high:"15.7500", normalTextEn:"", ...patch,
});
const staged = (...rows: Array<{data:Record<string,string>;status?:string}>) =>
  stagedRangeContextIndex(rows.map(row=>({status:row.status||"WARNING",normalizedData:row.data})));

test("same exact population/context detects numeric-equivalent duplicate across entire batch", () => {
  const left=range(), right=range({low:"012.500",high:"15.75",ageFrom:"00",ageTo:"018.00",testName:" hgb "});
  const index=staged({data:left},{data:right});
  assert.equal(stagedRangeContextIssue(left,index),"DUPLICATE_STAGED_RANGE_CONTEXT");
  assert.equal(stagedRangeContextIssue(right,index),"DUPLICATE_STAGED_RANGE_CONTEXT");
  assert.equal(index.size,1);
});

test("same staged context with different low/high or normal text requires conflict review", () => {
  const a=range(), b=range({high:"17.00"}), c=range({normalTextEn:"Normal according to source"});
  const index=staged({data:a},{data:b},{data:c});
  for (const candidate of [a,b,c])
    assert.equal(stagedRangeContextIssue(candidate,index),"CONFLICTING_STAGED_RANGE_CONTEXT");
});

test("distinct sex, age units, ranges, tests or units are NOT automatically equated", () => {
  const base=range();
  const index=staged(
    {data:base}, {data:range({sex:"FEMALE"})}, {data:range({ageUnit:"MONTH"})},
    {data:range({ageFrom:"18"})}, {data:range({testName:"Hemoglobin"})},
    {data:range({unit:"g/L"})},
  );
  assert.equal(index.size,6);
  assert.equal(stagedRangeContextIssue(base,index),null);
});

test("invalid or processed rows cannot fabricate an active source conflict", () => {
  const a=range();
  const index=staged(
    {data:a},{data:range({low:"99"}),status:"IMPORTED"},
    {data:range({low:"88"}),status:"SKIPPED"},
    {data:range({low:"77"}),status:"ERROR"},
    {data:range({ageFrom:"bad"})},{data:range({high:"1e9"})},
  );
  assert.equal(stagedRangeContextIssue(a,index),null);
  assert.equal(index.size,1);
});

test("review stays read only, scoped, original uploader, 100-row paginated and whole-batch bounded", () => {
  const source=readFileSync("src/app/api/catalog/imports/[id]/ranges/reconcile/route.ts","utf8");
  assert.match(source,/sourceType: "CSV_REVIEW"/);
  assert.match(source,/createdByUserId: session\.user\.id/);
  assert.match(source,/resolveClinicalImportScope/);
  assert.match(source,/clinicalImportTestWhere\(scope\)/);
  assert.match(source,/take: 20001/);
  assert.match(source,/allStaged\.length > 20000/);
  assert.match(source,/stagedRangeContextIndex\(allStaged\)/);
  assert.match(source,/stagedRangeContextIssue\(candidates\[i\], contextIndex\)/);
  assert.match(source,/take: PAGE_SIZE \+ 1/);
  assert.match(source,/liveWrites: false/);
  assert.match(source,/clinicalActivation: false/);
  assert.doesNotMatch(source,/referenceInterval\.(create|update)|prisma\.\$transaction/);
  const tests=[{id:"a",code:"HGB",nameEn:"Hemoglobin",status:"ACTIVE",defaultUnitId:"u",
    components:[{id:"c",unitId:"u",status:"ACTIVE"}]}];
  const units=[{id:"u",code:"GDL",symbol:"g/dL",status:"ACTIVE"}];
  const match=reconcileRangeReviewCandidate(range(),tests,units);
  assert.equal(match.disposition,"REVIEW_REQUIRED");
  assert.deepEqual(match.issues,["CLINICAL_APPROVAL_AND_CONTEXT_REQUIRED"]);
  assert.equal(rangeReviewCandidate(range()).high,"15.7500");
});
