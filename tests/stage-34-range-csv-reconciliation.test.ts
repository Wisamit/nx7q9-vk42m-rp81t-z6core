import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rangeReviewCandidate, reconcileRangeReviewCandidate } from "../src/lib/catalog-range-import-reconciliation.ts";

const tests = [
  { id: "test-a", code: "HGB", nameEn: "Hemoglobin", status: "ACTIVE", defaultUnitId: "unit-g",
    components: [{ id: "component-a", unitId: "unit-g", status: "ACTIVE" }] },
  { id: "test-b", code: "WBC", nameEn: "White Blood Cell", status: "ACTIVE", defaultUnitId: "unit-w",
    components: [{ id: "component-b", unitId: "unit-w", status: "ACTIVE" }] },
];
const units = [{id:"unit-g",code:"GDL",symbol:"g/dL",status:"ACTIVE"},
  {id:"unit-w",code:"WBCUNIT",symbol:"10^9/L",status:"ACTIVE"}];
const sample = {testName:" Hemoglobin ",unit:"g/dL",sex:"ANY",ageFrom:"",ageTo:"",
  ageUnit:"",low:"12.125",high:"17.250",normalTextEn:""};

test("CSV range reconciliation is exact, review only and never claims clinical approval", () => {
  const result = reconcileRangeReviewCandidate(sample,tests,units);
  assert.deepEqual(result,{disposition:"REVIEW_REQUIRED",issues:["CLINICAL_APPROVAL_AND_CONTEXT_REQUIRED"],
    testId:"test-a",componentId:"component-a",unitId:"unit-g"});
  assert.equal(reconcileRangeReviewCandidate({...sample,testName:"HGB"},tests,units).testId,"test-a");
  assert.equal(reconcileRangeReviewCandidate({...sample,testName:"Hemo"},tests,units).disposition,"BLOCKED");
  assert.equal(reconcileRangeReviewCandidate({...sample,unit:"10^9/L"},tests,units).issues[0],"COMPONENT_UNIT_CONFLICT");
  assert.equal(reconcileRangeReviewCandidate(sample,tests,units,["INVALID_CLINICAL_RANGE"]).disposition,"BLOCKED");
  const parsed = rangeReviewCandidate({testName:" الهيموغلوبين ",low:"-0.125000",high:"0.000001"});
  assert.equal(parsed.testName,"الهيموغلوبين");
  assert.equal(parsed.low,"-0.125000");
  assert.equal(parsed.high,"0.000001");
});

test("ambiguous unit/test identities and multi-component results require separate human clinical review", () => {
  assert.equal(reconcileRangeReviewCandidate(sample,[...tests,{...tests[0],id:"t2"}],units).issues[0],
    "AMBIGUOUS_SCOPED_TEST");
  assert.equal(reconcileRangeReviewCandidate(sample,tests,[...units,{...units[0],id:"u2"}]).issues[0],
    "AMBIGUOUS_UNIT");
  assert.equal(reconcileRangeReviewCandidate(sample,[{...tests[0],components:[
    ...tests[0].components,{id:"c2",unitId:"unit-g",status:"ACTIVE"},
  ]}],units).issues[0],"MULTI_COMPONENT_REVIEW_REQUIRED");
  assert.equal(reconcileRangeReviewCandidate(sample,[{...tests[0],status:"INACTIVE"}],units).issues[0],
    "TEST_NOT_IN_CLINICAL_SCOPE");
});

test("CSV range reconciliation endpoint has tenant/branch/department, original-uploader and read-only guards", () => {
  const source=readFileSync("src/app/api/catalog/imports/[id]/ranges/reconcile/route.ts","utf8");
  assert.match(source,/requirePermission\("catalog\.reference_ranges\.manage"\)/);
  assert.match(source,/permissionSet\(session\)\.has\("catalog\.manage"\)/);
  assert.match(source,/resolveClinicalImportScope/);
  assert.match(source,/clinicalImportTestWhere\(scope\)/);
  assert.match(source,/createdByUserId: session\.user\.id/);
  assert.match(source,/sourceType: "CSV_REVIEW"/);
  assert.match(source,/take: PAGE_SIZE \+ 1/);
  assert.match(source,/candidate: resolved \? candidates\[i\] : null/);
  assert.match(source,/liveWrites: false/);
  assert.match(source,/clinicalActivation: false/);
  assert.doesNotMatch(source,/tx\.referenceInterval\.create|tx\.referenceInterval\.update/);
});
