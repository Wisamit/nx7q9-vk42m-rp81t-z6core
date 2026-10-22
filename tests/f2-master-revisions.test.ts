import test from "node:test";
import assert from "node:assert/strict";
import {catalogExportTypes} from "../src/lib/catalog-configuration-export.ts";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {compileF2ApplyPlan,type F2ApplyPlan} from "../src/lib/catalog-f2-apply-plan.ts";
import {recordF2CatalogMasterRevisionsUnderLock,
  resolveF2CatalogMasterAsOf} from "../src/lib/catalog-f2-master-revisions.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const auth={
  organizationId:id(1),branchId:id(2),batchId:id(3),
  actorUserId:id(4),clinicalSignerId:id(5),financialSignerId:id(6),
  journalSigningSecret:"f2-master-versioned-synthetic-test-key-never-production",
  sourceInstallationVerified:true,qualifiedDomainSignersVerified:true,
  currentPermissionsAndBranchScopeVerified:true,signedStageAndLiveSnapshotVerified:true,
} as const;
const effectiveAt="2026-12-01T00:00:00.000Z";
const now=new Date("2026-10-21T00:00:00.000Z");
const changes:Record<string,(row:Record<string,unknown>)=>void>={
  TEST:x=>{x.nameEn="Revised test";},
  COMPONENT:x=>{x.reportNameEn="Revised component";},
  UNIT:x=>{x.ucumCode="mg/L";},
  CONTAINER:x=>{x.tubeColor="violet";},
  PANEL:x=>{x.items=[{testId:id(76),displayOrder:1,required:true,test:{code:"TEST"}}];},
  PACKAGE:x=>{x.items=[{testId:id(76),displayOrder:1,test:{code:"TEST"}}];},
  PRICE_LIST:x=>{x.nameEn="Revised tariff";},
};
function plan():F2ApplyPlan{
  const records=[...catalogExportTypes].map((entityType,index)=>{
    const old:Record<string,unknown>={};
    for(const field of catalogBundleAllowedSourceFields[entityType])old[field]=null;
    old.id=id(index+20);old.createdAt="2026-01-01T00:00:00.000Z";
    old.updatedAt="2026-10-20T00:00:00.000Z";
    if(Object.hasOwn(old,"code"))old.code="CODE"+index;
    const newer=structuredClone(old);
    changes[entityType]?.(newer);
    return {rowNumber:index+1,entityType,sourceData:newer,
      normalizedData:{id:old.id},scopedLiveData:old};
  });
  const result=compileF2ApplyPlan({rows:records,effectiveAt,
    signedStageVerified:true,independentDomainApprovalsVerified:true,
    scopedLiveSnapshotVerified:true});
  assert.ok(result);
  assert.equal(result.changedRows,7);
  return result;
}
function fakeDb(){
  const stored:Array<{id:string;sourceBatchId:string;sourceRowNumber:number;
    organizationId:string;entityType:string;entityId:string;
    revision:number;effectiveFrom:Date;effectiveTo:Date|null;
    state:string;afterSnapshot:unknown;planDigest:string;
    originalDigest:string;desiredDigest:string}>=[];
  const audits:Array<unknown>=[];
  let counter=300;
  const tx={
    catalogImportBatch:{
      findFirst:async()=>({id:auth.batchId}),
    },
    catalogConfigurationRevision:{
      findMany:async(opts:{where:Record<string,unknown>,take?:number})=>{
        const v=stored.filter(row=>Object.entries(opts.where).every(([key,value])=>{
          if(key==="effectiveFrom")return row.effectiveFrom<=(value as {lte:Date}).lte;
          if(key==="OR")return row.effectiveTo===null || row.effectiveTo>(value as Array<{
            effectiveTo?:{gt:Date}
          }>)[1].effectiveTo!.gt;
          return (row as unknown as Record<string,unknown>)[key]===value;
        }));
        return opts.where.entityId ? v.sort((x,y)=>y.revision-x.revision)
          .slice(0,opts.take??v.length):v;
      },
      create:async(opts:{data:Record<string,unknown>,select:{id:true}})=>{
        const v={...opts.data,id:id(counter++),effectiveTo:null} as typeof stored[number];
        stored.push(v);
        return {id:v.id};
      },
      updateMany:async(opts:{where:Record<string,unknown>;data:Record<string,unknown>})=>{
        const v=stored.find(x=>x.id===opts.where.id);
        if(!v||v.effectiveTo!==null)return {count:0};
        v.effectiveTo=opts.data.effectiveTo as Date;
        return {count:1};
      },
    },
    auditEvent:{create:async(v:unknown)=>{audits.push(v);return {id:id(counter++)};}},
  };
  return {stored,audits,tx};
}
test("F2: schedule all seven versionless catalog classes without mutating original master tables",async()=>{
  const p=plan(),db=fakeDb();
  const result=await recordF2CatalogMasterRevisionsUnderLock(
    db.tx as never,p,auth,now);
  assert.equal(result.state,"MASTER_REVISIONS_RECORDED");
  assert.equal(result.count,7);
  assert.equal(db.stored.length,7);
  assert.equal(db.audits.length,7);
  assert.equal(new Set(db.stored.map(x=>x.entityType)).size,7);
  assert.ok(db.stored.every(x=>x.revision===1&&x.state==="RECORDED"));
  assert.ok(db.stored.every(x=>x.effectiveFrom.toISOString()===effectiveAt));
  assert.equal(await resolveF2CatalogMasterAsOf(db.tx as never,{
    organizationId:auth.organizationId,entityType:"TEST",
    entityId:id(20),asOf:now}),null,"before effective date use baseline master");
  const effective=await resolveF2CatalogMasterAsOf(db.tx as never,{
    organizationId:auth.organizationId,entityType:"TEST",
    entityId:id(20),asOf:new Date("2026-12-02T00:00:00.000Z")});
  assert.equal(effective?.nameEn,"Revised test");
  const target=db.stored.find(x=>x.entityType==="TEST")!;
  const saved=target.afterSnapshot;
  target.afterSnapshot={...(saved as Record<string,unknown>),nameEn:"FORGED MEDICAL NAME"};
  await assert.rejects(()=>resolveF2CatalogMasterAsOf(db.tx as never,{
    organizationId:auth.organizationId,entityType:"TEST",entityId:id(20),
    asOf:new Date("2026-12-02T00:00:00.000Z"),
  }),/snapshot_corrupt/);
  target.afterSnapshot=saved;
  const unchanged=await resolveF2CatalogMasterAsOf(db.tx as never,{
    organizationId:auth.organizationId,entityType:"REFERENCE_INTERVAL",
    entityId:id(26),asOf:new Date("2026-12-02T00:00:00.000Z")}).then(
      ()=>"unexpected",()=> "rejected");
  assert.equal(unchanged,"rejected","native version types do not use overlays");
  const again=await recordF2CatalogMasterRevisionsUnderLock(
    db.tx as never,p,auth,now);
  assert.equal(again.state,"MASTER_REVISIONS_ALREADY_RECORDED");
  assert.equal(db.stored.length,7);
  assert.equal(db.audits.length,7);
});
test("F2: missing source proof, forged plan or changed unsupported class never writes",async()=>{
  const p=plan(),db=fakeDb();
  await assert.rejects(()=>recordF2CatalogMasterRevisionsUnderLock(
    db.tx as never,p,{...auth,sourceInstallationVerified:false as true},now),
    /unauthorized/);
  await assert.rejects(()=>recordF2CatalogMasterRevisionsUnderLock(
    db.tx as never,p,{...auth,qualifiedDomainSignersVerified:false as true},now),
    /unauthorized/);
  await assert.rejects(()=>recordF2CatalogMasterRevisionsUnderLock(
    db.tx as never,{...p,planDigest:"0".repeat(64)},auth,now),
    /unauthorized/);
  await assert.rejects(()=>recordF2CatalogMasterRevisionsUnderLock(
    db.tx as never,p,auth,new Date("2026-12-01T00:00:00.000Z")),
    /future_date/);
  assert.equal(db.stored.length,0);
  assert.equal(db.audits.length,0);
});
