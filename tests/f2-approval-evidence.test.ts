import test from "node:test";
import assert from "node:assert/strict";
import { createCatalogApprovalEvidence,parseCatalogApprovalEvidence,
  verifyCatalogApprovalHistory,type CatalogApprovalContext,
} from "../src/lib/catalog-f2-approval-evidence.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const secret="synthetic-f2-only-HMAC-key-never-operational-source-32";
const context:CatalogApprovalContext={
  organizationId:id(1),batchId:id(2),branchId:id(3),authorUserId:id(4),
  sourceChecksum:"a".repeat(64),stagedEvidenceDigest:"b".repeat(64),
  liveSnapshotDigest:"c".repeat(64),policyDigest:"d".repeat(64),
  effectiveAt:"2026-10-22T00:00:00.000Z",
};
const first=createCatalogApprovalEvidence(context,{
  revision:1,previousDigest:null,domain:"CLINICAL",decision:"APPROVE",
  signerUserId:id(5),mfaVerifiedAt:"2026-10-20T12:00:00.000Z",
  signedAt:"2026-10-20T12:04:00.000Z",
},secret);
const second=createCatalogApprovalEvidence(context,{
  revision:2,previousDigest:first.digest,domain:"FINANCIAL",decision:"APPROVE",
  signerUserId:id(6),mfaVerifiedAt:"2026-10-20T12:04:00.000Z",
  signedAt:"2026-10-20T12:05:00.000Z",
},secret);
const event=(record:typeof first,i:number)=>({
  id:id(20+i),actorUserId:record.signerUserId,
  branchId:context.branchId,newValues:record,
});
const run=(events:ReturnType<typeof event>[],contextOverride=context,signingKey=secret)=>
  verifyCatalogApprovalHistory({context:contextOverride,events,secret:signingKey});

test("F2: two distinct MFA-fresh signers bind domain, staged source, live target and effective date",()=>{
  assert.deepEqual(parseCatalogApprovalEvidence(first,context,secret),first);
  assert.deepEqual(parseCatalogApprovalEvidence(second,context,secret),second);
  assert.deepEqual(run([]),{revision:0,clinical:null,financial:null,
    technicallyApproved:false,sourceInstallationVerified:false,
    qualifiedHumanApprovalVerified:false,liveApplyAuthorized:false});
  const one=run([event(first,1)]);
  assert.equal(one?.technicallyApproved,false);
  const two=run([event(second,2),event(first,1)]);
  assert.equal(two?.technicallyApproved,true);
  assert.deepEqual(two?.clinical,first);
  assert.deepEqual(two?.financial,second);
  assert.equal(two?.liveApplyAuthorized,false);
  assert.equal(two?.qualifiedHumanApprovalVerified,false);
  assert.equal(two?.sourceInstallationVerified,false);
  assert.deepEqual(run([event(first,1),event(second,2)]),two,
    "same-time physical SQL order is not causal authority");
});

test("F2: source, tenant, branch, policy, target snapshot and seal mutations reject",()=>{
  for(const field of ["organizationId","batchId","branchId","authorUserId",
    "sourceChecksum","stagedEvidenceDigest","liveSnapshotDigest","policyDigest",
    "effectiveAt"] as const){
    const alteredContext={...context,[field]:
      field==="effectiveAt"?"2026-10-24T00:00:00.000Z":
      field.endsWith("Id")?id(99):"f".repeat(64)};
    assert.equal(parseCatalogApprovalEvidence(first,alteredContext,secret),null,field);
  }
  for(const key of ["signerUserId","mfaVerifiedAt","signedAt","decision",
    "revision","previousDigest","digest","liveWrites","state"]){
    assert.equal(parseCatalogApprovalEvidence({
      ...first,[key]:key==="revision"?2:key==="liveWrites"?true:"CORRUPT",
    },context,secret),null,key);
  }
  assert.equal(parseCatalogApprovalEvidence({...first,seal:{
    ...first.seal,signature:"0".repeat(64),
  }},context,secret),null);
  assert.equal(parseCatalogApprovalEvidence({...first,extra:true},context,secret),null);
  assert.equal(parseCatalogApprovalEvidence(first,context,
    "different-f2-hmac-key-never-production-use-only-32"),null);
  assert.equal(run([event(first,1)],context,
    "different-f2-hmac-key-never-production-use-only-32"),null);
});

test("F2: reject stale MFA, self-approval, same reviewer, same domain, reversed timestamps and forged chain",()=>{
  const create=(patch:Partial<Parameters<typeof createCatalogApprovalEvidence>[1]>)=>
    createCatalogApprovalEvidence(context,{
      revision:1,previousDigest:null,domain:"CLINICAL",decision:"APPROVE",
      signerUserId:id(5),mfaVerifiedAt:"2026-10-20T12:00:00.000Z",
      signedAt:"2026-10-20T12:04:00.000Z",...patch,
    },secret);
  assert.throws(()=>create({signerUserId:context.authorUserId}));
  assert.throws(()=>create({mfaVerifiedAt:"2026-10-20T11:00:00.000Z"}));
  assert.throws(()=>create({mfaVerifiedAt:"2026-10-20T12:05:00.000Z"}));
  assert.throws(()=>create({previousDigest:"f".repeat(64)}));
  assert.equal(run([event(second,2)]),null,"missing first revision");
  assert.equal(run([event(first,1),event(first,2)]),null,"duplicate revision");
  assert.equal(run([event(first,1),{...event(first,2),id:event(first,1).id}]),null);
  assert.equal(run([event(first,1),{...event(second,2),actorUserId:id(100)}]),null);
  assert.equal(run([event(first,1),{...event(second,2),branchId:id(100)}]),null);
  const otherSigner=createCatalogApprovalEvidence(context,{
    revision:2,previousDigest:first.digest,domain:"FINANCIAL",
    decision:"APPROVE",signerUserId:id(5),
    mfaVerifiedAt:"2026-10-20T12:04:00.000Z",
    signedAt:"2026-10-20T12:05:00.000Z",
  },secret);
  assert.equal(run([event(first,1),event(otherSigner,2)]),null);
  const sameDomain=createCatalogApprovalEvidence(context,{
    revision:2,previousDigest:first.digest,domain:"CLINICAL",
    decision:"APPROVE",signerUserId:id(6),
    mfaVerifiedAt:"2026-10-20T12:04:00.000Z",
    signedAt:"2026-10-20T12:05:00.000Z",
  },secret);
  assert.equal(run([event(first,1),event(sameDomain,2)]),null);
  const reversedTime=createCatalogApprovalEvidence(context,{
    revision:2,previousDigest:first.digest,domain:"FINANCIAL",
    decision:"APPROVE",signerUserId:id(6),
    mfaVerifiedAt:"2026-10-20T11:59:00.000Z",
    signedAt:"2026-10-20T12:00:00.000Z",
  },secret);
  assert.equal(run([event(first,1),event(reversedTime,2)]),null);
  const forged=createCatalogApprovalEvidence(context,{
    revision:2,previousDigest:"f".repeat(64),domain:"FINANCIAL",
    decision:"APPROVE",signerUserId:id(6),
    mfaVerifiedAt:"2026-10-20T12:04:00.000Z",
    signedAt:"2026-10-20T12:05:00.000Z",
  },secret);
  assert.equal(run([event(first,1),event(forged,2)]),null);
  assert.equal(run([event(first,1),event(second,2),event(first,3)]),null);
});

test("F2: recorded rejection stays non-executable and cannot be converted to approval",()=>{
  const reject=createCatalogApprovalEvidence(context,{
    revision:2,previousDigest:first.digest,domain:"FINANCIAL",
    decision:"REJECT",signerUserId:id(6),
    mfaVerifiedAt:"2026-10-20T12:04:00.000Z",
    signedAt:"2026-10-20T12:05:00.000Z",
  },secret);
  const history=run([event(first,1),event(reject,2)]);
  assert.equal(history?.financial?.decision,"REJECT");
  assert.equal(history?.technicallyApproved,false);
  assert.equal(history?.liveApplyAuthorized,false);
});
