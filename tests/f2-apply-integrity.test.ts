import test from "node:test";
import assert from "node:assert/strict";
import {
  compileF2ApplyPlan,verifyF2ApplyPlanIntegrity,
  type F2ApplyPlan,
} from "../src/lib/catalog-f2-apply-plan.ts";
import {catalogExportTypes} from "../src/lib/catalog-configuration-export.ts";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {applyF2EffectiveVersionsUnderLock} from "../src/lib/catalog-f2-effective-versions.ts";
import {reverseF2FutureEffectiveVersionsUnderLock} from "../src/lib/catalog-f2-effective-reversal.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const key="canonical-test-HMAC-key-never-production-do-not-use-32";
const now=new Date("2026-10-21T00:00:00.000Z");
function compiled():F2ApplyPlan{
  const rows=[...catalogExportTypes].map((entityType,i)=>{
    const previous:Record<string,unknown>={};
    for(const field of catalogBundleAllowedSourceFields[entityType])previous[field]=null;
    previous.id=id(i+30);
    if(Object.hasOwn(previous,"code"))previous.code="CODE"+i;
    previous.createdAt="2026-01-01T00:00:00.000Z";
    previous.updatedAt="2026-10-21T00:00:00.000Z";
    const source=structuredClone(previous);
    if(entityType==="PRICE_LIST_ITEM"||entityType==="PRICE_LIST_PACKAGE_ITEM"){
      previous.effectiveFrom="2026-01-01T00:00:00.000Z";
      previous.effectiveTo=null;previous.status="ACTIVE";
      previous.unitPrice="100.0100";
      Object.assign(source,previous,{unitPrice:"90.0050"});
    }
    if(entityType==="REFERENCE_INTERVAL"){
      previous.effectiveFrom="2026-01-01T00:00:00.000Z";
      previous.effectiveTo=null;previous.status="ACTIVE";
      previous.approvalStatus="APPROVED";
      previous.criticalLow="1.000000";
      Object.assign(source,previous,{criticalLow:"2.000000"});
    }
    return {rowNumber:i+1,entityType,
      sourceData:source,scopedLiveData:previous,
      normalizedData:{id:previous.id}};
  });
  const plan=compileF2ApplyPlan({
    rows,effectiveAt:"2026-12-01T00:00:00.000Z",
    signedStageVerified:true,independentDomainApprovalsVerified:true,
    scopedLiveSnapshotVerified:true,
  });
  assert.ok(plan);assert.equal(plan.changedRows,3);
  return plan;
}
const authority={
  organizationId:id(1),branchId:id(2),batchId:id(3),
  actorUserId:id(4),clinicalSignerId:id(5),financialSignerId:id(6),
  journalSigningSecret:key,
  sourceInstallationVerified:true,qualifiedDomainSignersVerified:true,
  currentPermissionsAndBranchScopeVerified:true,signedStageAndLiveSnapshotVerified:true,
} as const;
type MutableRecord=Record<string,unknown>;
const mutate=(original:F2ApplyPlan,change:(draft:MutableRecord)=>void)=>{
  const draft=structuredClone(original) as unknown as MutableRecord;
  change(draft);
  return draft;
};
const draftRows=(p:MutableRecord)=>p.rows as MutableRecord[];
const draftRow=(p:MutableRecord,index=0)=>draftRows(p)[index];
const value=(p:MutableRecord,index:number,key:"originalSnapshot"|"desiredSnapshot")=>
  draftRow(p,index)[key] as MutableRecord;

test("F2: independently recompile full ten-class plan before SQL mutation",()=>{
  const original=compiled();
  assert.equal(verifyF2ApplyPlanIntegrity(original),true);
  const changes:Array<(draft:MutableRecord)=>void>=[
    p=>{p.planDigest="f".repeat(64);},
    p=>{p.changedRows=0;},
    p=>{(p.operations as MutableRecord).EFFECTIVE_DATED_NEW_VERSION=0;},
    p=>{draftRow(p).operation="UNCHANGED";},
    p=>{draftRow(p).changedFields=["status"];},
    p=>{draftRow(p).originalDigest="f".repeat(64);},
    p=>{draftRow(p).desiredDigest="f".repeat(64);},
    p=>{value(p,0,"originalSnapshot").code="BACKDOOR";},
    p=>{value(p,0,"desiredSnapshot").code="BACKDOOR";},
    p=>{value(p,0,"desiredSnapshot").extra="BACKDOOR";},
    p=>{draftRow(p).targetId=id(300);},
    p=>{draftRows(p).reverse();},
    p=>{p.effectiveAt="2026-12-02T00:00:00.000Z";},
    p=>{draftRows(p).push(draftRow(p));},
    p=>{p.supervisorApproval=true;},
  ];
  for(const change of changes)assert.equal(
    verifyF2ApplyPlanIntegrity(mutate(original,change)),false,
    "any modified count, plan digest, historical value or extra key must reject");
});
test("F2: forged plan fails apply AND reversal without any SQL call",async()=>{
  const p=mutate(compiled(),draft=>{
    const index=draftRows(draft).findIndex(r=>r.entityType==="REFERENCE_INTERVAL");
    value(draft,index,"desiredSnapshot").criticalLow="999.000000";
  });
  let called=false;
  const tx={auditEvent:{findMany:async()=>{called=true;throw Error("unexpected query");}}};
  await assert.rejects(()=>applyF2EffectiveVersionsUnderLock(
    tx as never,p as unknown as F2ApplyPlan,authority,now),/f2_apply_unauthorized/);
  await assert.rejects(()=>reverseF2FutureEffectiveVersionsUnderLock(
    tx as never,p,authority,now),/f2_reversal_unauthorized/);
  assert.equal(called,false);
});
