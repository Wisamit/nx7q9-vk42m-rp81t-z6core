import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEGACY_SPECIALTY_EVIDENCE_TYPE,buildSelectedSpecialtyEvidenceReview,
  LegacySpecialtyEvidenceError,parseSpecialtyEvidence,
} from "../src/lib/legacy-specialty-evidence.ts";
import { clinicalImportTestWhere,resolveClinicalImportScope } from "../src/lib/catalog-clinical-import-scope.ts";

const candidate=(prefix:string)=>({
  sourcePrefix:prefix,lowColumn:prefix+"LOW",highColumn:prefix+"HIGH",
  observations:[{rowNumber:1,low:"1.0",high:"4.0",sex:null,
    ageFrom:null,ageTo:null,ageUnit:null}],
});
const makeEvidence=()=>parseSpecialtyEvidence({
  schemaVersion:1,evidenceType:LEGACY_SPECIALTY_EVIDENCE_TYPE,
  sourceName:"Family lab -test.mdb",sourceSha256:"f".repeat(64),
  exportedAtUtc:"2026-10-14T11:00:00.000Z",clinicalUseApproved:false,
  tables:[
    {tableName:"Thyroidn",pairingComplete:true,warnings:[],candidatePairs:[
      candidate("TSH"),candidate("FT4"),
    ]},
    {tableName:"cbcn",pairingComplete:true,warnings:[],candidatePairs:[
      candidate("WBC"),candidate("RBC"),candidate("HGB"),
    ]},
  ],
});
const active=[
  {id:"c1",code:"TSH",nameEn:"TSH",nameAr:null},
  {id:"c2",code:"FT3",nameEn:"FT3",nameAr:null},
];
test("Stage 119: only explicitly selected legacy specialty table contributes pairing counts",()=>{
  const data=makeEvidence();
  const review=buildSelectedSpecialtyEvidenceReview(data,active,"Thyroidn");
  assert.equal(review.selectedTable,"Thyroidn");
  assert.equal(review.sourceTablesInUpload,2);
  assert.equal(review.excludedOtherSourceTables,1);
  assert.equal(review.tableCount,1);
  assert.equal(review.totalCandidatePairs,2);
  assert.equal(review.exactCodePairCount,1);
  assert.equal(review.unmatchedPairs,1);
  assert.deepEqual(review.notRepresentedBySourceRangePairs,["FT3"]);
  assert.equal(review.tables[0].pairs.some(p=>p.prefix==="WBC"),false);
  assert.equal(review.reviewOnly,true);
  assert.equal(review.clinicalMappingConfirmed,false);
  assert.equal(review.sourceSnapshotVerified,false);
  assert.equal(review.referenceIntervalsImported,false);
  assert.equal(review.layoutApplied,false);
  assert.ok(!JSON.stringify(review).includes('"low":"1.0"'));
});
test("Stage 119: table selection cannot be guessed or silently replaced",()=>{
  const data=makeEvidence();
  for(const selection of ["","Thyroid","cbc","cbcn ","ID","thyroidn"]){
    assert.throws(()=>buildSelectedSpecialtyEvidenceReview(data,active,selection),
      (error:unknown)=>error instanceof LegacySpecialtyEvidenceError &&
        error.code==="unsupported_selected_specialty_table");
  }
  assert.throws(()=>buildSelectedSpecialtyEvidenceReview(data,active,"coagn"),
    (error:unknown)=>error instanceof LegacySpecialtyEvidenceError &&
      error.code==="selected_specialty_table_not_in_evidence");
});
test("Stage 119: duplicate case-insensitive component codes remain ambiguous",()=>{
  const review=buildSelectedSpecialtyEvidenceReview(makeEvidence(),[
    {id:"c1",code:"TSH",nameEn:"TSH",nameAr:null},
    {id:"c2",code:"tsh",nameEn:"TSH 2",nameAr:null},
  ],"Thyroidn");
  assert.equal(review.tables[0].pairs[0].matchStatus,"AMBIGUOUS_CODE");
  assert.deepEqual(review.ambiguousConfiguredCodes,["TSH"]);
  assert.equal(review.exactCodePairCount,0);
});
test("Stage 119: department/branch policy is not relaxed for an off-branch test",()=>{
  const scope=resolveClinicalImportScope({
    organizationId:"O",activeBranchId:"A",
    activeBranch:{id:"A",organizationId:"O",status:"ACTIVE"},
    branchScopes:[{branchId:"A",branch:{status:"ACTIVE"}}],
    departmentScopes:[{departmentId:"D_A",department:{
      status:"ACTIVE",organizationId:"O",branchId:"A",
    }}],
  });
  assert.ok(scope);
  assert.deepEqual(scope.departmentIds,["D_A"]);
  assert.equal(clinicalImportTestWhere(scope).organizationId,"O");
  assert.equal(scope.departmentIds.includes("D_B"),false);
  const denied=resolveClinicalImportScope({
    organizationId:"O",activeBranchId:"A",
    activeBranch:{id:"A",organizationId:"O",status:"ACTIVE"},
    branchScopes:[{branchId:"A",branch:{status:"ACTIVE"}}],
    departmentScopes:[{departmentId:"D_B",department:{
      status:"ACTIVE",organizationId:"O",branchId:"B",
    }}],
  });
  assert.equal(denied,null);
});
test("Stage 119: review route rechecks live clinical scope without writes or full source echo",()=>{
  const route=readFileSync("src/app/api/catalog/legacy-specialty-evidence/route.ts","utf8");
  const ui=readFileSync("src/components/legacy-specialty-evidence-review.tsx","utf8");
  assert.match(route,/resolveClinicalImportScope/);
  assert.match(route,/clinicalImportTestWhere\(liveScope\)/);
  assert.match(route,/tx\.userBranchScope\.findMany/);
  assert.match(route,/tx\.userDepartmentScope\.findMany/);
  assert.match(route,/originalBranches/);
  assert.match(route,/originalDepartments/);
  assert.match(route,/catalog\.manage/);
  assert.match(route,/status:"ACTIVE"/);
  assert.match(route,/buildSelectedSpecialtyEvidenceReview/);
  assert.match(route,/RepeatableRead/);
  assert.match(route,/private, no-store/);
  assert.doesNotMatch(route,/tx\.(?:referenceInterval|testComponent|labTest|labOrder|laboratoryResult|invoice)\.(?:create|update|upsert|delete|createMany|updateMany)\(/);
  assert.match(ui,/selectedTable/);
  const modal=readFileSync("src/components/legacy-evidence-review-dialog.tsx","utf8");
  assert.match(ui,/<LegacyEvidenceReviewDialog/);
  assert.match(ui,/sourceTables=\{LEGACY_TABLES\}/);
  assert.match(modal,/not an approved clinical mapping/);
  assert.match(modal,/does not associate an Access table with a laboratory test/);
  assert.match(ui,/notRepresentedBySourceRangePairs/);
  assert.match(ui,/dir=\{locale==="ar"\?"rtl":"ltr"\}/);
});
