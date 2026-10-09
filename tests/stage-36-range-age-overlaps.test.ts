import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  stagedRangeAgeOverlapIndex, stagedRangeAgeOverlapIssue, stagedRangeContextIndex, stagedRangeContextIssue,
} from "../src/lib/catalog-range-import-reconciliation.ts";

const candidate = (overrides: Record<string, string> = {}) => ({
  testName: "HGB", unit: "g/dL", sex: "FEMALE", ageUnit: "YEAR",
  ageFrom: "0.000", ageTo: "5.000", low: "12.500000", high: "17.000000",
  normalTextEn: "", ...overrides,
});
const stage = (...rows: Array<{ data: ReturnType<typeof candidate>; status?: string }>) =>
  rows.map(row => ({ normalizedData: row.data, status: row.status ?? "WARNING" }));
const issue = (row: ReturnType<typeof candidate>, rows: ReturnType<typeof stage>) =>
  stagedRangeAgeOverlapIssue(row, stagedRangeAgeOverlapIndex(rows));

test("same exact source identity, distinct intersecting age windows all receive advisory", () => {
  const a = candidate(), b = candidate({ ageFrom: "1", ageTo: "10" });
  const c = candidate({ ageFrom: "4", ageTo: "6" });
  const rows = stage({data:a}, {data:b}, {data:c});
  for(const row of [a,b,c]) assert.equal(issue(row,rows),"POTENTIAL_STAGED_AGE_WINDOW_OVERLAP");
  assert.equal(stagedRangeContextIssue(a,stagedRangeContextIndex(rows)),null,
    "Stage 35 exact-context checks must remain independent");
});

test("touching age endpoints are potential overlap until boundary policy is reviewed", () => {
  const a=candidate({ageFrom:"0",ageTo:"12"});
  const b=candidate({ageFrom:"12.000",ageTo:"18"});
  const rows=stage({data:a},{data:b});
  assert.equal(issue(a,rows),"POTENTIAL_STAGED_AGE_WINDOW_OVERLAP");
  assert.equal(issue(b,rows),"POTENTIAL_STAGED_AGE_WINDOW_OVERLAP");
});

test("non-overlapping ages and repeated identical windows do not produce new overlap warning", () => {
  const a=candidate(), b=candidate({ageFrom:"6",ageTo:"10"});
  const rows=stage({data:a},{data:b});
  assert.equal(issue(a,rows),null);
  assert.equal(issue(b,rows),null);
  const duplicate=stage({data:a},{data:candidate({ageFrom:"00.000",ageTo:"05.0"})});
  assert.equal(issue(a,duplicate),null);
  assert.equal(stagedRangeContextIssue(a,stagedRangeContextIndex(duplicate)),"DUPLICATE_STAGED_RANGE_CONTEXT");
});

test("does not assume name aliases, units, sex wildcard or age-unit conversion", () => {
  const a=candidate();
  const rows=stage(
    {data:a},
    {data:candidate({testName:"Hemoglobin"})},
    {data:candidate({unit:"g/L"})},
    {data:candidate({sex:"ANY"})},
    {data:candidate({ageUnit:"MONTH"})},
  );
  assert.equal(issue(a,rows),null);
});

test("only complete explicit valid staged windows count; skip historical processed/error rows", () => {
  const a=candidate();
  for (const row of [
    {data:candidate({ageFrom:"1",ageTo:"6"}),status:"ERROR"},
    {data:candidate({ageFrom:"1",ageTo:"6"}),status:"IMPORTED"},
    {data:candidate({ageFrom:"1",ageTo:"6"}),status:"SKIPPED"},
    {data:candidate({ageFrom:"-1",ageTo:"6"})},
    {data:candidate({ageFrom:"2",ageTo:"1"})},
    {data:candidate({ageFrom:"1e5",ageTo:"6"})},
    {data:candidate({ageFrom:"",ageTo:"6"})},
    {data:candidate({ageFrom:"1",ageTo:""})},
    {data:candidate({ageFrom:"1",ageTo:"6",ageUnit:""})},
  ]) assert.equal(issue(a,stage({data:a},row)),null);
});

test("range reconciliation endpoint is read-only and protects batch/org/uploader and clinical scope",()=>{
  const route=readFileSync("src/app/api/catalog/imports/[id]/ranges/reconcile/route.ts","utf8");
  assert.match(route,/stagedRangeAgeOverlapIndex\(allStaged\)/);
  assert.match(route,/stagedRangeAgeOverlapIssue\(candidates\[i\], ageOverlaps\)/);
  assert.match(route,/stagedAgeWindowOverlaps:/);
  assert.match(route,/createdByUserId: session\.user\.id/);
  assert.match(route,/clinicalImportTestWhere\(scope\)/);
  assert.match(route,/organizationId: scope\.organizationId/);
  assert.match(route,/take: 20001/);
  assert.match(route,/allStaged\.length > 20000/);
  assert.match(route,/liveWrites: false/);
  assert.match(route,/clinicalActivation: false/);
  assert.doesNotMatch(route,/referenceInterval\.(create|update)|prisma\.\$transaction/);
});
