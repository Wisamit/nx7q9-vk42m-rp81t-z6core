import test from "node:test";
import assert from "node:assert/strict";
import { compileF2ApplyPlan } from "../src/lib/catalog-f2-apply-plan.ts";
import { applyF2EffectiveVersionsUnderLock } from "../src/lib/catalog-f2-effective-versions.ts";
import { catalogBundleAllowedSourceFields } from "../src/lib/catalog-bundle-source-boundary.ts";
import { catalogExportTypes } from "../src/lib/catalog-configuration-export.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const authority={
  organizationId:id(1),branchId:id(2),batchId:id(3),actorUserId:id(4),
  journalSigningSecret:"f2-synthetic-version-journal-signer-not-production-32",
  clinicalSignerId:id(5),financialSignerId:id(6),
  sourceInstallationVerified:true,qualifiedDomainSignersVerified:true,
  currentPermissionsAndBranchScopeVerified:true,
  signedStageAndLiveSnapshotVerified:true,
} as const;
function fixture(){
  const rows=[...catalogExportTypes].map((entityType,i)=>{
    const source:Record<string,unknown>={};
    for(const field of catalogBundleAllowedSourceFields[entityType])source[field]=null;
    source.id=id(i+11);source.code="C"+i;
    source.createdAt="2026-01-01T00:00:00.000Z";
    source.updatedAt="2026-10-21T00:00:00.000Z";
    if(["PRICE_LIST_ITEM","PRICE_LIST_PACKAGE_ITEM","REFERENCE_INTERVAL"].includes(entityType)){
      source.effectiveFrom="2026-01-01T00:00:00.000Z";
      source.effectiveTo=null;source.status="ACTIVE";
    }
    if(entityType==="REFERENCE_INTERVAL"){
      source.componentId=id(77);source.approvalStatus="APPROVED";
      source.criticalLow="2.000000";
    }else if(entityType==="PRICE_LIST_ITEM"){
      source.priceListId=id(66);source.testId=id(44);
      source.unitPrice="90.0025";
    }else if(entityType==="PRICE_LIST_PACKAGE_ITEM"){
      source.priceListId=id(66);source.packageId=id(55);
      source.unitPrice="72.1025";
    }
    const live=structuredClone(source);
    if(entityType==="REFERENCE_INTERVAL")live.criticalLow="3.000000";
    if(entityType==="PRICE_LIST_ITEM")live.unitPrice="100.0011";
    if(entityType==="PRICE_LIST_PACKAGE_ITEM")live.unitPrice="80.0150";
    return {rowNumber:i+1,entityType,sourceData:source,
      normalizedData:{id:source.id},scopedLiveData:live};
  });
  const plan=compileF2ApplyPlan({rows,
    effectiveAt:"2026-12-01T00:00:00.000Z",
    signedStageVerified:true,independentDomainApprovalsVerified:true,
    scopedLiveSnapshotVerified:true,
  });assert.ok(plan);assert.equal(plan.changedRows,3);
  return plan;
}

test("F2: transaction core creates three new effective-dated versions, keeps original IDs and writes append-only journal",async()=>{
  const p=fixture();
  const price=p.rows.find(r=>r.entityType==="PRICE_LIST_ITEM")!;
  const packagePrice=p.rows.find(r=>r.entityType==="PRICE_LIST_PACKAGE_ITEM")!;
  const rangePrice=p.rows.find(r=>r.entityType==="REFERENCE_INTERVAL")!;
  const actions:Array<{table:string;action:string;args:any}>=[];
  const events:Array<{id:string;newValues:unknown}>=[];
  let seq=50;
  const record=(table:string,action:string,args:any)=>{
    actions.push({table,action,args});
    return {id:id(seq++)};
  };
  const tx={
    auditEvent:{
      findMany:async()=>events.filter(e=>
        (e.newValues as Record<string,unknown>)?.planDigest===p.planDigest),
      create:async(args:any)=>{
        const result=record("auditEvent","create",args);
        if(args.data.action==="CATALOG_F2_EFFECTIVE_BATCH_APPLIED")
          events.push({id:result.id,newValues:args.data.newValues});
        return result;
      },
    },
    priceListItem:{
      findMany:async()=>[{id:price.targetId}],
      updateMany:async(args:any)=>{record("priceListItem","updateMany",args);return {count:1};},
      create:async(args:any)=>record("priceListItem","create",args),
    },
    priceListPackageItem:{
      findMany:async()=>[{id:packagePrice.targetId}],
      updateMany:async(args:any)=>{record("priceListPackageItem","updateMany",args);return {count:1};},
      create:async(args:any)=>record("priceListPackageItem","create",args),
    },
    referenceInterval:{
      findMany:async()=>[{id:rangePrice.targetId}],
      updateMany:async(args:any)=>{record("referenceInterval","updateMany",args);return {count:1};},
      create:async(args:any)=>record("referenceInterval","create",args),
    },
  };
  const outcome=await applyF2EffectiveVersionsUnderLock(tx as never,p,authority,
    new Date("2026-10-21T00:00:00.000Z"));
  assert.equal(outcome.state,"EFFECTIVE_VERSIONS_APPLIED");
  assert.equal(outcome.createdVersionIds.length,3);
  assert.equal(outcome.journalEventIds.length,3);
  assert.equal(actions.filter(a=>a.action==="updateMany").length,3);
  assert.equal(actions.filter(a=>a.action==="create"&&a.table!=="auditEvent").length,3);
  const batch=actions.find(a=>a.table==="auditEvent" &&
    a.args.data.action==="CATALOG_F2_EFFECTIVE_BATCH_APPLIED");
  assert.ok(batch);
  for(const action of actions.filter(a=>a.action==="updateMany")){
    assert.equal(action.args.data.effectiveTo.toISOString(),p.effectiveAt);
    assert.equal(action.args.where.effectiveTo,null);
  }
  const prices=actions.filter(a=>a.table==="priceListItem"&&a.action==="create");
  assert.equal(prices[0].args.data.unitPrice,"90.0025");
  assert.notEqual(prices[0].args.data.id,price.targetId);
  const range=actions.find(a=>a.table==="referenceInterval"&&a.action==="create")!;
  assert.equal(range.args.data.criticalLow,"2.000000");
  assert.equal(range.args.data.approvalStatus,"APPROVED");
  assert.equal(range.args.data.approvedByUserId,authority.clinicalSignerId);
  const actionsBefore=actions.length;
  const repeated=await applyF2EffectiveVersionsUnderLock(tx as never,p,authority,
    new Date("2026-10-21T00:00:00.000Z"));
  assert.equal(repeated.state,"EFFECTIVE_VERSIONS_ALREADY_APPLIED");
  assert.equal(actions.length,actionsBefore,"idempotent repeat cannot create further versions");
});

test("F2: unauthorized, backdated and unsupported class changes cannot mutate masters",async()=>{
  const p=fixture();let called=false;
  const tx={auditEvent:{findMany:async()=>{called=true;return [];}}};
  await assert.rejects(()=>applyF2EffectiveVersionsUnderLock(
    tx as never,p,{...authority,qualifiedDomainSignersVerified:false as true},
    new Date("2026-10-21T00:00:00.000Z")),/unauthorized/);
  await assert.rejects(()=>applyF2EffectiveVersionsUnderLock(
    tx as never,p,authority,new Date("2026-12-02T00:00:00.000Z")),/future_effective/);
  assert.equal(called,false);
  const unsupported={...p,rows:p.rows.map(row=>row.entityType==="UNIT"?{
    ...row,operation:"SCALAR_VERSIONED_CHANGE" as const,changedFields:["nameEn"],
  }:row)};
  await assert.rejects(()=>applyF2EffectiveVersionsUnderLock(
    tx as never,unsupported,authority,new Date("2026-10-21T00:00:00.000Z")),
    /other_class_support_pending/);
  assert.equal(called,false);
});
