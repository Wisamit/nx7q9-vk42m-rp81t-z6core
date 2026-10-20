import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  sealReviewStageEvidence, type ReviewStageEvidenceContext,
  type ReviewStageEvidenceBatchMetadata,
} from "../src/lib/catalog-review-stage-evidence.ts";
import { verifyIndependentExpertStage } from "../src/lib/catalog-expert-stage-integrity.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+n.toString(16).padStart(12,"0");
const secret="synthetic-F2-independent-expert-stage-key-32-bytes";
const row={id:id(4),rowNumber:1,entityType:"TEST",legacyKey:id(5),
  status:"WARNING",importedEntityId:null,
  sourceData:{id:id(5),code:"T",nameEn:"Synthetic",status:"ACTIVE"},
  normalizedData:{id:id(5),code:"T",nameEn:"Synthetic",status:"ACTIVE"},
  validationIssues:[{code:"CONFIGURATION_BUNDLE_REVIEW_ONLY",severity:"WARNING"}],
};
const context:ReviewStageEvidenceContext={
  organizationId:id(1),batchId:id(2),authorUserId:id(3),
  sourceChecksum:"a".repeat(64),rows:[row],
};
const summary={
  total:1,WARNING:1,format:"family-lab-catalog-bundle",
  consistency:"transactional-consistent-read",exportedAt:"2026-10-20T00:00:00.000Z",
  attestationStatus:"VERIFIED",fieldContractStatus:"COMPLETE_SOURCE_FIELD_PROJECTION",
  reviewOnly:true,counts:{TEST:1},
};
const metadata:ReviewStageEvidenceBatchMetadata={
  sourceType:"CONFIG_BUNDLE_REVIEW",sourceName:"safe.json",status:"DRAFT",summary,
};
const seal=sealReviewStageEvidence({...context,batchMetadata:metadata},secret);
const verify=(changes:Partial<Parameters<typeof verifyIndependentExpertStage>[0]>={})=>
  verifyIndependentExpertStage({context,metadata,seal,secret,...changes});

test("F2 independent expert: complete original source and authenticated persisted v2 rows required",()=>{
  assert.deepEqual(verify(),{ok:true});
  assert.deepEqual(verify({seal:null}),{
    ok:false,error:"expert_staged_evidence_integrity_error",
  });
  assert.deepEqual(verify({secret:null}),{
    ok:false,error:"expert_staged_evidence_integrity_error",
  });
  assert.deepEqual(verify({metadata:null}),{
    ok:false,error:"expert_staged_evidence_integrity_error",
  });
  assert.deepEqual(verify({seal:sealReviewStageEvidence(context,secret)}),{
    ok:false,error:"expert_staged_evidence_integrity_error",
  });
  for(const replacement of [
    {...row,sourceData:{...row.sourceData,nameEn:"Retouched"}},
    {...row,normalizedData:{...row.normalizedData,code:"REWRITTEN"}},
    {...row,validationIssues:[{code:"REWRITTEN"}]},
    {...row,rowNumber:2},
    {...row,status:"APPLIED"},
  ]){
    assert.deepEqual(verify({context:{...context,rows:[replacement]}}),{
      ok:false,error:"expert_staged_evidence_integrity_error",
    });
  }
  for(const altered of [
    {sourceChecksum:"b".repeat(64)}, {batchId:id(99)},
    {authorUserId:id(99)}, {organizationId:id(99)},
  ]){
    assert.deepEqual(verify({context:{...context,...altered}}),{
      ok:false,error:"expert_staged_evidence_integrity_error",
    });
  }
});
test("F2 expert: a newly valid signed unsigned/legacy/non-atomic DRAFT is still NOT eligible",()=>{
  for(const patch of [
    {attestationStatus:"UNVERIFIED"},
    {fieldContractStatus:"LEGACY_NO_FIELD_CONTRACT"},
    {consistency:"paged-live-not-atomic"},
  ]){
    const changed={...metadata,summary:{...summary,...patch}};
    const updatedSeal=sealReviewStageEvidence({
      ...context,batchMetadata:changed,
    },secret);
    assert.deepEqual(verify({metadata:changed,seal:updatedSeal}),{
      ok:false,error:"expert_source_not_qualified",
    });
  }
});
test("F2 expert: route checks sealed original persisted rows before independent preflight/decision",()=>{
  const src=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  const queue=readFileSync("src/app/api/catalog/imports/expert-review-queue/route.ts","utf8");
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(src,/reviewStageBatchMetadata\(batch\)/);
  assert.match(src,/verifyIndependentExpertStage\(/);
  assert.match(src,/if \(expert\) \{\s*const metadata/);
  assert.match(src,/legacyKey: true/);
  assert.match(src,/validationIssues: true/);
  const verifyAt=src.indexOf("verifyIndependentExpertStage(");
  assert.ok(verifyAt > 0 && verifyAt < src.indexOf("const expertFlag = expert ?") &&
    verifyAt < src.indexOf("expertDispositionAllowed(") &&
    verifyAt < src.indexOf('action: "CATALOG_BUNDLE_EXPERT_DECISION_RECORDED"'));
  assert.match(src,/if \(!evidence\.ok\)\s*return \{ error: evidence\.error, httpStatus: 409 \}/);
  assert.doesNotMatch(queue,/sourceData: true/);
  assert.match(commit,/CONFIG_BUNDLE_REVIEW/);
  assert.match(commit,/CSV_REVIEW/);
  assert.doesNotMatch(src,/tx\.(?:labTest|referenceInterval|priceListItem|catalogImportRow)\.(?:create|update|delete|upsert)/);
});
