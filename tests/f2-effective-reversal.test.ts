import test from "node:test";
import assert from "node:assert/strict";
import { reverseF2FutureEffectiveVersionsUnderLock } from "../src/lib/catalog-f2-effective-reversal.ts";
import { signF2ApplicationJournal } from "../src/lib/catalog-f2-application-journal.ts";
import type { F2ApplyPlan,F2ApplyPlanRow } from "../src/lib/catalog-f2-apply-plan.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const effectiveAt="2026-12-01T00:00:00.000Z";
const org=id(1),branch=id(2),batch=id(3);
const auth={
  organizationId:org,branchId:branch,batchId:batch,actorUserId:id(4),
  journalSigningSecret:"f2-synthetic-reversal-journal-not-production-32",
  clinicalSignerId:id(5),financialSignerId:id(6),
  sourceInstallationVerified:true,qualifiedDomainSignersVerified:true,
  currentPermissionsAndBranchScopeVerified:true,
  signedStageAndLiveSnapshotVerified:true,
} as const;
const types=["PRICE_LIST_ITEM","PRICE_LIST_PACKAGE_ITEM","REFERENCE_INTERVAL"] as const;
const rows:F2ApplyPlanRow[]=types.map((entityType,index)=>({
  rowNumber:index+1,entityType,targetId:id(10+index),
  operation:"EFFECTIVE_DATED_NEW_VERSION",changedFields:[
    entityType==="REFERENCE_INTERVAL"?"criticalLow":"unitPrice"],
  originalSnapshot:{
    id:id(10+index),unitPrice:"50.0000",criticalLow:"1.000000",
    effectiveFrom:"2026-01-01T00:00:00.000Z",effectiveTo:null,status:"ACTIVE",
  },
  desiredSnapshot:{
    id:id(10+index),unitPrice:"40.0000",criticalLow:"2.000000",
    effectiveFrom:"2026-01-01T00:00:00.000Z",effectiveTo:null,status:"ACTIVE",
  },
  originalDigest:"a".repeat(64),desiredDigest:"b".repeat(64),
}));
const plan:F2ApplyPlan={
  format:"F2_TEN_CLASS_EXECUTABLE_PLAN_V1",totalRows:3,
  changedRows:3,unchangedRows:0,effectiveAt,
  operations:{UNCHANGED:0,SCALAR_VERSIONED_CHANGE:0,
    COMPOSITE_MEMBERSHIP_CHANGE:0,EFFECTIVE_DATED_NEW_VERSION:3},
  rows,planDigest:"c".repeat(64),
};
const journalIds=rows.map((_,i)=>id(30+i));
const clonedIds=rows.map((_,i)=>id(50+i));

test("F2: future-effective compensation retains old and new versions and writes a single reversal journal",async()=>{
  const calls:Array<{type:string,kind:string,args:any}>=[];
  let completed=false;
  const record=(type:string,kind:string,args:any)=>{
    calls.push({type,kind,args});return {id:id(calls.length+100)};
  };
  const tx={
    auditEvent:{
      findMany:async(args:any)=>{
        const action=args.where.action;
        if(action==="CATALOG_F2_EFFECTIVE_BATCH_REVERSED")
          return completed?[{newValues:signF2ApplicationJournal({
            planDigest:plan.planDigest,
          },auth.journalSigningSecret)}]:[];
        if(action==="CATALOG_F2_EFFECTIVE_BATCH_APPLIED")
          return [{newValues:signF2ApplicationJournal({
            planDigest:plan.planDigest,effectiveAt,
            journalEventIds:journalIds,createdVersionIds:clonedIds,
          },auth.journalSigningSecret)}];
        if(action==="CATALOG_F2_VERSION_CLONED")
          return rows.map((row,index)=>({
            id:journalIds[index],entityType:row.entityType,entityId:row.targetId,
            newValues:signF2ApplicationJournal({
              planDigest:plan.planDigest,batchId:batch,effectiveAt,
              newVersionId:clonedIds[index],
              originalDigest:row.originalDigest,
              desiredDigest:row.desiredDigest,
              before:row.originalSnapshot,after:row.desiredSnapshot,
            },auth.journalSigningSecret),
          }));
        throw Error("unexpected audit read");
      },
      create:async(args:any)=>{
        if(args.data.action==="CATALOG_F2_EFFECTIVE_BATCH_REVERSED")completed=true;
        return record("auditEvent","create",args);
      },
    },
    priceListItem:{
      findFirst:async()=>null,
      updateMany:async(args:any)=>{record("priceListItem","update",args);return {count:1};},
    },
    priceListPackageItem:{
      findFirst:async()=>null,
      updateMany:async(args:any)=>{record("priceListPackageItem","update",args);return {count:1};},
    },
    referenceInterval:{
      findFirst:async()=>null,
      updateMany:async(args:any)=>{record("referenceInterval","update",args);return {count:1};},
    },
  };
  const result=await reverseF2FutureEffectiveVersionsUnderLock(
    tx as never,plan,auth,new Date("2026-11-01T00:00:00.000Z"));
  assert.equal(result.state,"FUTURE_EFFECTIVE_VERSIONS_REVERSED");
  assert.equal(result.changedRows,3);
  const updates=calls.filter(call=>call.kind==="update");
  assert.equal(updates.length,6);
  assert.equal(updates.filter(call=>call.args.data.effectiveTo===null).length,3);
  assert.equal(updates.filter(call=>call.args.data.status==="INACTIVE").length,3);
  assert.equal(updates.filter(call=>call.args.data.approvalStatus==="RETIRED").length,1);
  assert.equal(calls.filter(call=>call.args.data?.action==="CATALOG_F2_EFFECTIVE_BATCH_REVERSED").length,1);
  const count=calls.length;
  const replay=await reverseF2FutureEffectiveVersionsUnderLock(
    tx as never,plan,auth,new Date("2026-11-01T00:00:00.000Z"));
  assert.equal(replay.state,"FUTURE_VERSIONS_ALREADY_REVERSED");
  assert.equal(calls.length,count);
});
test("F2: no past-date rewind and no stale signer scope can reach the DB",async()=>{
  const tx={auditEvent:{findMany:async()=>{throw Error("must not reach DB");}}};
  await assert.rejects(()=>reverseF2FutureEffectiveVersionsUnderLock(
    tx as never,plan,auth,new Date("2026-12-02T00:00:00.000Z")),/pre_effective_date/);
  await assert.rejects(()=>reverseF2FutureEffectiveVersionsUnderLock(
    tx as never,plan,{...auth,qualifiedDomainSignersVerified:false as true},
    new Date("2026-11-01T00:00:00.000Z")),/unauthorized/);
});
