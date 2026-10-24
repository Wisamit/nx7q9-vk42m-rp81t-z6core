import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {f2ExactUtcInstant} from "../src/lib/catalog-f2-utc-instant.ts";
import {createCatalogApprovalEvidence,parseCatalogApprovalEvidence,
  verifyCatalogApprovalHistory,type CatalogApprovalContext} from "../src/lib/catalog-f2-approval-evidence.ts";
import {compileF2ApplyPlan,verifyF2ApplyPlanIntegrity,
  type F2ApplySourceRow} from "../src/lib/catalog-f2-apply-plan.ts";
import {catalogExportTypes} from "../src/lib/catalog-configuration-export.ts";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const key="F8-f2-utc-only-never-use-in-production-example-key-12345";
const validAt="2028-02-29T23:59:59.999Z";
const invalid=[
  "2026-02-29T00:00:00.000Z",
  "2026-02-30T00:00:00.000Z",
  "2028-02-30T00:00:00.000Z",
  "2026-04-31T00:00:00.000Z",
  "2026-06-31T00:00:00.000Z",
  "2026-11-31T00:00:00.000Z",
  "2026-13-01T00:00:00.000Z",
  "2026-00-01T00:00:00.000Z",
  "2026-12-00T00:00:00.000Z",
  "2026-12-32T00:00:00.000Z",
  "2026-12-01T24:00:00.000Z",
  "2026-12-01T00:60:00.000Z",
  "2026-12-01T00:00:60.000Z",
  "2026-12-01T00:00:00Z",
  "2026-12-01T00:00:00.000+00:00",
  "2026-12-01T00:00:00.000z",
  "2026-12-01T00:00:00.000Z ",
  " 2026-12-01T00:00:00.000Z",
  "not-a-date", "", null, undefined, 123,
];
const ctx:CatalogApprovalContext={
  organizationId:id(1),batchId:id(2),branchId:id(3),authorUserId:id(4),
  sourceChecksum:"a".repeat(64),stagedEvidenceDigest:"b".repeat(64),
  liveSnapshotDigest:"c".repeat(64),policyDigest:"d".repeat(64),
  effectiveAt:validAt,
};
const approved=(at:string)=>({
  revision:1 as const,previousDigest:null,domain:"CLINICAL" as const,
  decision:"APPROVE" as const,signerUserId:id(5),
  mfaVerifiedAt:at,signedAt:at,
});
function rows():F2ApplySourceRow[]{
  return [...catalogExportTypes].map((entityType,i)=>{
    const source:Record<string,unknown>={};
    for(const name of catalogBundleAllowedSourceFields[entityType])source[name]=null;
    source.id=id(100+i);
    if(Object.hasOwn(source,"code"))source.code="TEST_"+i;
    source.createdAt="2026-01-01T00:00:00.000Z";
    source.updatedAt="2026-10-01T00:00:00.000Z";
    const live=structuredClone(source);
    return {rowNumber:i+1,entityType,sourceData:source,
      normalizedData:{id:source.id},scopedLiveData:live};
  });
}
const plan=(effectiveAt:string)=>compileF2ApplyPlan({
  rows:rows(),effectiveAt,signedStageVerified:true,
  independentDomainApprovalsVerified:true,scopedLiveSnapshotVerified:true,
});

test("F8 §87: signed exact UTC milliseconds never silently roll impossible clinical/finance dates",()=>{
  assert.equal(f2ExactUtcInstant("2026-12-01T00:00:00.000Z"),
    Date.parse("2026-12-01T00:00:00.000Z"));
  assert.equal(f2ExactUtcInstant(validAt),Date.parse(validAt));
  assert.equal(f2ExactUtcInstant("2028-02-29T00:00:00.000Z"),
    Date.parse("2028-02-29T00:00:00.000Z"));
  for(const value of invalid)
    assert.equal(f2ExactUtcInstant(value),null,String(value));
  assert.notEqual(Date.parse("2026-02-30T00:00:00.000Z"),
    Date.parse("2026-02-28T00:00:00.000Z"),
    "JS Date.parse can shift an invalid calendar day; our guard must never do so");
});

test("F8 F2: independent signed clinical/financial approval rejects impossible effective date",()=>{
  for(const value of invalid){
    const candidate={...ctx,effectiveAt:value as string};
    assert.throws(()=>createCatalogApprovalEvidence(candidate,approved(
      "2026-10-24T00:00:00.000Z"),key),/f2_approval_evidence_invalid/,
      "must block human approval for "+String(value));
    assert.equal(verifyCatalogApprovalHistory({
      context:candidate,events:[],secret:key,
    }),null);
  }
  const ok=createCatalogApprovalEvidence(ctx,approved(
    "2026-10-24T00:00:00.000Z"),key);
  assert.deepEqual(parseCatalogApprovalEvidence(ok,ctx,key),ok);
  const forgedContext={...ctx,effectiveAt:"2028-02-30T00:00:00.000Z"};
  assert.equal(parseCatalogApprovalEvidence({...ok,effectiveAt:forgedContext.effectiveAt},
    forgedContext,key),null);
});

test("F8 F2: signed MFA and decision timestamps may not roll to another day",()=>{
  for(const value of invalid){
    assert.throws(()=>createCatalogApprovalEvidence(ctx,
      {...approved("2026-10-24T00:00:00.000Z"),signedAt:value as string},key),
      /f2_approval_evidence_invalid/);
    assert.throws(()=>createCatalogApprovalEvidence(ctx,
      {...approved("2026-10-24T00:00:00.000Z"),mfaVerifiedAt:value as string},key),
      /f2_approval_evidence_invalid/);
  }
});

test("F8 F2: executable ten-class apply plan rejects rolled fiscal/clinical effective date",()=>{
  assert.ok(plan("2028-02-29T00:00:00.000Z"));
  assert.ok(plan("2026-12-01T00:00:00.000Z"));
  for(const value of invalid){
    assert.equal(plan(value as string),null,
      "never sign or schedule at another day: "+String(value));
  }
  const valid=plan(validAt);
  assert.ok(valid);
  assert.equal(verifyF2ApplyPlanIntegrity(valid),true);
  const modified=structuredClone(valid);
  modified.effectiveAt="2028-02-30T00:00:00.000Z";
  assert.equal(verifyF2ApplyPlanIntegrity(modified),false);
});

test("F8 F2: application of effective-dated versions rechecks exact source dates",()=>{
  const approval=readFileSync("src/lib/catalog-f2-approval-evidence.ts","utf8");
  const compiler=readFileSync("src/lib/catalog-f2-apply-plan.ts","utf8");
  const version=readFileSync("src/lib/catalog-f2-effective-versions.ts","utf8");
  const route=readFileSync("src/app/api/catalog/imports/[id]/configuration-apply/route.ts","utf8");
  const executor=readFileSync("src/lib/catalog-f2-governed-application.ts","utf8");
  for(const source of [approval,compiler,version])
    assert.ok(source.includes("f2ExactUtcInstant"),"date validator missing in F2 gate");
  assert.ok(route.includes("applyF2ConfigurationFromVerifiedDatabaseUnderLock"));
  assert.ok(executor.includes("verifyCatalogApprovalHistory"));
  assert.ok(executor.includes("compileF2ApplyPlan"));
  assert.ok(executor.includes("applyF2EffectiveVersionsUnderLock"));
  assert.ok(version.includes("verifyF2ApplyPlanIntegrity"));
});
