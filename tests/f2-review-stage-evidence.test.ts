import test from "node:test";
import assert from "node:assert/strict";
import { sealReviewStageEvidence, verifyReviewStageEvidence } from "../src/lib/catalog-review-stage-evidence.ts";

const uuid=(suffix: number)=>"00000000-0000-4000-8000-"+suffix.toString(16).padStart(12,"0");
const secret="family-lab-test-stage-authenticity-key-material";
const row={id:uuid(4),rowNumber:1,entityType:"REFERENCE_INTERVAL",legacyKey:uuid(5),
  status:"WARNING",importedEntityId:null,
  sourceData:{id:uuid(5),lowValue:"0.000001",criticalHigh:"9.000000",
    component:{code:"COMP",test:{code:"TEST"}}},
  normalizedData:{id:uuid(5),componentCode:"COMP",testCode:"TEST"},
  validationIssues:[{severity:"WARNING",code:"CONFIGURATION_BUNDLE_REVIEW_ONLY"}],
};
const context={organizationId:uuid(1),batchId:uuid(2),
  authorUserId:uuid(3),sourceChecksum:"a".repeat(64),rows:[row]};

test("F2: signed staging evidence covers persisted source and normalized JSON, row order, and tenant lineage",()=>{
  const seal=sealReviewStageEvidence(context,secret);
  assert.equal(verifyReviewStageEvidence(context,seal,secret),true);
  // Stable under JSON object property order changes only.
  const reordered={...context,rows:[{...row,
    sourceData:{criticalHigh:"9.000000",component:{test:{code:"TEST"},code:"COMP"},
      id:uuid(5),lowValue:"0.000001"}}]};
  assert.equal(verifyReviewStageEvidence(reordered,seal,secret),true);
  for(const changed of [
    {...context,organizationId:uuid(31)},
    {...context,batchId:uuid(32)},
    {...context,authorUserId:uuid(33)},
    {...context,sourceChecksum:"b".repeat(64)},
    {...context,rows:[{...row,sourceData:{...row.sourceData,criticalHigh:"9.000001"}}]},
    {...context,rows:[{...row,normalizedData:{...row.normalizedData,testCode:"FORGED"}}]},
    {...context,rows:[{...row,validationIssues:[]}]},
    {...context,rows:[{...row,rowNumber:2}]},
    {...context,rows:[{...row,id:uuid(88)}]},
    {...context,rows:[{...row,legacyKey:uuid(55)}]},
    {...context,rows:[{...row,status:"APPLIED"}]},
    {...context,rows:[{...row,importedEntityId:uuid(99)}]},
  ]) assert.equal(verifyReviewStageEvidence(changed,seal,secret),false);
});

test("F2: missing, spoofed, malformed and re-keyed seals are rejected without downgrade",()=>{
  const seal=sealReviewStageEvidence(context,secret);
  assert.equal(verifyReviewStageEvidence(context,seal,null),false);
  assert.equal(verifyReviewStageEvidence(context,seal,"z".repeat(64)),false);
  assert.equal(verifyReviewStageEvidence(context,null,secret),false);
  assert.equal(verifyReviewStageEvidence(context,"UNSEALED",secret),false);
  assert.equal(verifyReviewStageEvidence(context,{...seal,algorithm:"SHA256"},secret),false);
  assert.equal(verifyReviewStageEvidence(context,{...seal,version:2},secret),false);
  assert.equal(verifyReviewStageEvidence(context,{...seal,signature:"0".repeat(64)},secret),false);
  assert.equal(verifyReviewStageEvidence(context,{...seal,extra:true},secret),false);
  assert.equal(verifyReviewStageEvidence(context,{...seal,signature:"hi"},secret),false);
  assert.throws(()=>sealReviewStageEvidence({...context,rows:[]},secret));
  assert.throws(()=>sealReviewStageEvidence({...context,rows:[row,row]},secret));
  assert.throws(()=>sealReviewStageEvidence(context,"short"));
});
