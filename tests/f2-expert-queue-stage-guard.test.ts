import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sealReviewStageEvidence, type ReviewStageEvidenceContext,
  type ReviewStageEvidenceBatchMetadata } from "../src/lib/catalog-review-stage-evidence.ts";
import { verifyIndependentExpertStage } from "../src/lib/catalog-expert-stage-integrity.ts";

const queue=readFileSync("src/app/api/catalog/imports/expert-review-queue/route.ts","utf8");
const review=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
const secret="synthetic-F2-reviewer-queue-gate-key-not-production-32bytes";
const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const row={id:id(4),rowNumber:1,entityType:"PRICE_LIST_ITEM",legacyKey:id(5),
  status:"WARNING",importedEntityId:null,
  sourceData:{id:id(5),unitPrice:"20.0000"},
  normalizedData:{id:id(5),unitPrice:"20.0000"},
  validationIssues:[{severity:"WARNING",code:"CONFIGURATION_BUNDLE_REVIEW_ONLY"}],
};
const context:ReviewStageEvidenceContext={
  organizationId:id(1),batchId:id(2),authorUserId:id(3),
  sourceChecksum:"c".repeat(64),rows:[row],
};
const metadata:ReviewStageEvidenceBatchMetadata={
  sourceType:"CONFIG_BUNDLE_REVIEW",sourceName:"export.json",status:"DRAFT",
  summary:{
    total:1,WARNING:1,reviewOnly:true,format:"family-lab-catalog-bundle",
    consistency:"transactional-consistent-read",exportedAt:"2026-10-20T00:00:00.000Z",
    attestationStatus:"VERIFIED",fieldContractStatus:"COMPLETE_SOURCE_FIELD_PROJECTION",
    counts:{PRICE_LIST_ITEM:1},
  },
};
const seal=sealReviewStageEvidence({...context,batchMetadata:metadata},secret);

test("F2: the queue never equates a valid current flag token with an authenticated source",()=>{
  assert.deepEqual(verifyIndependentExpertStage({context,metadata,seal,secret}),{ok:true});
  assert.deepEqual(verifyIndependentExpertStage({context:{...context,rows:[{
    ...row,normalizedData:{...row.normalizedData,unitPrice:"99999.0000"},
  }]},metadata,seal,secret}),{
    ok:false,error:"expert_staged_evidence_integrity_error",
  });
  const weakMetadata={...metadata,summary:{
    ...(metadata.summary as object),attestationStatus:"UNVERIFIED",
  }};
  assert.deepEqual(verifyIndependentExpertStage({
    context,metadata:weakMetadata,
    seal:sealReviewStageEvidence({...context,batchMetadata:weakMetadata},secret),secret,
  }),{ok:false,error:"expert_source_not_qualified"});
});

test("F2: expert queue fully verifies bounded stage envelopes before exposing metadata-only entries",()=>{
  assert.match(queue,/signingSecret = catalogBundleSigningSecret\(process\.env\)/);
  assert.match(queue,/if \(!signingSecret\)/);
  assert.match(queue,/groupBy\(\{\s*by: \["batchId"\]/);
  assert.match(queue,/budget \+ count > BUNDLE_REVIEW_MAX_ROWS/);
  assert.match(queue,/take: BUNDLE_REVIEW_MAX_ROWS \+ 1/);
  assert.match(queue,/legacyKey: true, status: true, sourceData: true/);
  assert.match(queue,/normalizedData: true, validationIssues: true/);
  assert.match(queue,/importedEntityId: true/);
  assert.match(queue,/if \(evidenceRows\.length !== budget\)/);
  assert.match(queue,/metadata: reviewStageBatchMetadata\(batch\)/);
  assert.match(queue,/verifyIndependentExpertStage\(/);
  assert.match(queue,/if \(result\.ok\) verifiedBatches\.set\(id, batch\)/);
  assert.match(queue,/const batchById = verifiedBatches/);
  assert.match(queue,/batchById\.get\(row\.batchId\)/);
  assert.match(queue,/hasMore: flags\.length === 100 \|\| evidenceTruncated/);
  assert.match(queue,/isolationLevel: "RepeatableRead"/);
  assert.match(review,/verifyIndependentExpertStage\(/);
  assert.ok(queue.indexOf("verifyIndependentExpertStage(") <
    queue.indexOf("entries.push({"),
    "queue entries can only be created after stage integrity eligibility");
});

test("F2: internal clinical/price source JSON cannot leave expert queue response",()=>{
  const entryStart=queue.indexOf("entries.push({");
  const entryEnd=queue.indexOf("});",entryStart);
  assert.ok(entryStart > 0 && entryEnd > entryStart);
  const entry=queue.slice(entryStart,entryEnd);
  for(const forbidden of ["sourceData","normalizedData","validationIssues",
    "sourceChecksum","stageEvidenceSeal","unitPrice","sourceName","mappingApproved",
  ]) assert.equal(entry.includes(forbidden),false,forbidden);
  assert.match(entry,/flagEventId: flag\.id, batchId: batch\.id/);
  assert.match(queue,/approval: false, application: false/);
  assert.doesNotMatch(queue, /tx\.(?:labTest|referenceInterval|priceList|priceListItem|catalogImportRow)\.(?:create|update|delete|upsert)\(/);
});
