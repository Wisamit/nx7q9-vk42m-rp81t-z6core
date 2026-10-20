import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MAPPING_DISCUSSION_HISTORY_LIMIT, createMappingDiscussionDraft,
  mappingDiscussionCurrent, mappingDiscussionDigest,
  parseMappingDiscussionDraft, validMappingDiscussionIntent,
  verifyMappingDiscussionHistory, type MappingDiscussionContext,
} from "../src/lib/catalog-mapping-discussion-draft.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const context:MappingDiscussionContext={
  organizationId:id(1),batchId:id(2),branchId:id(3),rowId:id(4),
  authorUserId:id(5),sourceChecksum:"a".repeat(64),
  rowNumber:17,entityType:"REFERENCE_INTERVAL",
};
const token="b".repeat(64);
const first=createMappingDiscussionDraft(context,{
  revision:1,previousDigest:null,observationToken:token,
  intent:"REQUEST_EXTERNAL_MAPPING",
});
const second=createMappingDiscussionDraft(context,{
  revision:2,previousDigest:first.digest,observationToken:"c".repeat(64),
  intent:"RETURN_TO_SOURCE_AUTHOR",
});
const events=[
  {id:id(7),branchId:context.branchId,actorUserId:context.authorUserId,newValues:second},
  {id:id(6),branchId:context.branchId,actorUserId:context.authorUserId,newValues:first},
];

test("F2 mapping: a draft is bounded, canonical and emphatically never an approval",()=>{
  assert.equal(validMappingDiscussionIntent("APPROVE_TARGET"),false);
  assert.equal(validMappingDiscussionIntent("REQUEST_EXTERNAL_MAPPING"),true);
  assert.equal(validMappingDiscussionIntent("PROPOSE_LOCAL_RECONCILIATION"),true);
  assert.equal(first.state,"UNAPPROVED_MAPPING_DISCUSSION");
  for(const key of ["approved","signingEnabled","mappingApproved","activated","liveWrites"])
    assert.equal(first[key as keyof typeof first],false,key);
  assert.equal(first.reviewOnly,true);
  assert.match(first.digest,/^[a-f0-9]{64}$/);
  assert.deepEqual(parseMappingDiscussionDraft(first,context),first);
  assert.equal(mappingDiscussionDigest({
    ...context,revision:1,previousDigest:null,observationToken:token,
    intent:"REQUEST_EXTERNAL_MAPPING",
  }),first.digest);
  assert.equal(mappingDiscussionCurrent(first,token),true);
  assert.equal(mappingDiscussionCurrent(first,"c".repeat(64)),false);
  assert.equal(mappingDiscussionCurrent(null,token),false);
  assert.equal(first.digest===second.digest,false);
  assert.deepEqual(verifyMappingDiscussionHistory({context,events}),{
    revision:2,draft:second,
  });
  assert.deepEqual(verifyMappingDiscussionHistory({context,events:[]}),{
    revision:0,draft:null,
  });
  assert.equal(MAPPING_DISCUSSION_HISTORY_LIMIT,100);
});
test("F2 mapping: source/tenant/branch/author/row/revision and chain mutations fail closed",()=>{
  for(const field of ["organizationId","batchId","branchId","rowId",
    "authorUserId","sourceChecksum","rowNumber","entityType"] as const){
    const damaged={...first,[field]:field==="rowNumber"?18:
      field==="entityType"?"PRICE_LIST_ITEM":
      field==="sourceChecksum"?"f".repeat(64):id(99)};
    assert.equal(parseMappingDiscussionDraft(damaged,context),null,field);
  }
  for(const key of ["approved","signingEnabled","mappingApproved","activated","liveWrites"]){
    assert.equal(parseMappingDiscussionDraft({...first,[key]:true},context),null,key);
  }
  assert.equal(parseMappingDiscussionDraft({...first,extra:"UNKNOWN"},context),null);
  assert.equal(parseMappingDiscussionDraft({...first,intent:"APPROVE"},context),null);
  assert.equal(parseMappingDiscussionDraft({...first,observationToken:"a".repeat(64)},context),null);
  assert.equal(parseMappingDiscussionDraft({...first,digest:"0".repeat(64)},context),null);
  assert.equal(parseMappingDiscussionDraft({...first,revision:2},context),null);
  assert.equal(parseMappingDiscussionDraft({...first,previousDigest:second.digest},context),null);
  assert.equal(parseMappingDiscussionDraft({...first,approved:1},context),null);
  assert.throws(()=>createMappingDiscussionDraft(context,{
    revision:0,previousDigest:null,observationToken:token,
    intent:"REQUEST_EXTERNAL_MAPPING",
  }));
  assert.throws(()=>createMappingDiscussionDraft(context,{
    revision:101,previousDigest:null,observationToken:token,
    intent:"REQUEST_EXTERNAL_MAPPING",
  }));
});
test("F2 mapping: full history rejects invisible foreign actor/branch, omissions and fork",()=>{
  const wrong=(patch:Record<string,unknown>)=>{
    const cloned=structuredClone(events);
    cloned[1]={...cloned[1],...patch};
    assert.equal(verifyMappingDiscussionHistory({context,events:cloned}),null);
  };
  wrong({branchId:id(99)});
  wrong({actorUserId:id(99)});
  wrong({newValues:{...first,intent:"RETURN_TO_SOURCE_AUTHOR"}});
  wrong({id:events[0].id});
  assert.equal(verifyMappingDiscussionHistory({context,events:[events[0]]}),null);
  assert.equal(verifyMappingDiscussionHistory({context,events:[events[1],events[0]]}),null);
  assert.equal(verifyMappingDiscussionHistory({context,events:[
    events[0],events[0],
  ]}),null);
  assert.equal(verifyMappingDiscussionHistory({context,events:Array(101).fill(events[0])}),null);
  const fork=createMappingDiscussionDraft(context,{
    revision:2,previousDigest:"f".repeat(64),
    observationToken:"c".repeat(64),intent:"RETURN_TO_SOURCE_AUTHOR",
  });
  assert.equal(verifyMappingDiscussionHistory({context,events:[
    {...events[0],newValues:fork},events[1],
  ]}),null);
});
test("F2 mapping: GET/POST use current locked stage, optimistic revision, fresh observation and audit only",()=>{
  const route=readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts","utf8");
  assert.match(route,/mappingDraftRow/);
  assert.match(route,/mapping_discussion_query_invalid/);
  assert.match(route,/request\.nextUrl\.searchParams\.has\("mappingDraft"\)/);
  assert.match(route,/mapping_discussion_invalid_request/);
  assert.match(route,/if \(expert \|\| mappingDiscussionInput \|\| mappingDiscussionRow !== null\)/);
  assert.match(route,/verifyIndependentExpertStage\(/);
  assert.match(route,/const requestedMappingRow=mappingDiscussionInput\?\.rowNumber \?\? mappingDiscussionRow/);
  assert.match(route,/verifyMappingDiscussionHistory\(/);
  assert.match(route,/if \(!matchesCatalogDriftObservation\(/);
  assert.match(route,/mapping_discussion_evidence_stale/);
  assert.match(route,/mapping_discussion_revision_conflict/);
  assert.match(route,/identity\.status!=="LOCAL_IDENTITY_OBSERVED"/);
  assert.match(route,/mapping_discussion_local_identity_not_observed/);
  assert.match(route,/MAPPING_DISCUSSION_UNCHANGED/);
  assert.match(route,/action:"CATALOG_BUNDLE_MAPPING_DISCUSSION_DRAFT_RECORDED"/);
  assert.match(route,/expectedRevision: value\.expectedRevision/);
  assert.match(route,/isolationLevel: "RepeatableRead"/);
  assert.doesNotMatch(route,/tx\.(?:labTest|referenceInterval|priceList|priceListItem|catalogImportRow)\.(?:create|update|upsert|delete)\(/);
  const commit=readFileSync("src/app/api/catalog/imports/[id]/commit/route.ts","utf8");
  assert.match(commit,/CONFIG_BUNDLE_REVIEW/);
  assert.match(commit,/CSV_REVIEW/);
});
