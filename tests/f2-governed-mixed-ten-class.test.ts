import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import {catalogExportTypes} from "../src/lib/catalog-configuration-export.ts";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {catalogDriftObservationToken} from "../src/lib/catalog-drift-triage.ts";
import {createCatalogApprovalEvidence} from "../src/lib/catalog-f2-approval-evidence.ts";
import {executeF2GovernedApplicationUnderLock,
  type F2GovernedExecutionInput} from "../src/lib/catalog-f2-governed-application.ts";
const id=(i:number)=>"00000000-0000-4000-8000-"+String(i).padStart(12,"0");
const secret="synthetic-ten-class-mixed-version-application-HMAC-never-prod-32";
const start="2026-01-01T00:00:00.000Z",effect="2026-12-01T00:00:00.000Z";
const source={
  organizationId:id(1),branchId:id(2),batchId:id(3),actorUserId:id(4),
  authorUserId:id(5),sourceChecksum:"a".repeat(64),
  stageEvidenceDigest:"b".repeat(64),policyDigest:"c".repeat(64),
  effectiveAt:effect,sourceInstallationVerified:true,
  fullyScopedStageVerified:true,
  fullDomainSignatoryGrantsCurrentlyVerified:true,
  currentOperatorScopesVerified:true,
  independentlyVerifiedInstallationMapping:true,
  appliedVersionJournalValidated:true,
} as const;
function build():F2GovernedExecutionInput{
 const rows=[...catalogExportTypes].map((entityType,i)=>{
   const x:Record<string,unknown>={};
   for(const field of catalogBundleAllowedSourceFields[entityType])x[field]=null;
   x.id=id(i+30);x.createdAt=start;x.updatedAt=start;
   if(Object.hasOwn(x,"code"))x.code="C"+i;
   if(entityType==="PRICE_LIST_ITEM"||entityType==="PRICE_LIST_PACKAGE_ITEM"){
     x.priceListId=id(75);
     if(entityType==="PRICE_LIST_ITEM")x.testId=id(76);
     else x.packageId=id(77);
     x.unitPrice="80.0000";x.effectiveFrom=start;x.effectiveTo=null;x.status="ACTIVE";
   }
   if(entityType==="REFERENCE_INTERVAL"){
     x.componentId=id(78);x.criticalLow="1.000000";
     x.effectiveFrom=start;x.effectiveTo=null;x.status="ACTIVE";
     x.approvalStatus="APPROVED";
   }
   const desired=structuredClone(x);
   if(entityType==="TEST")desired.nameEn="Future revised test";
   if(entityType==="COMPONENT")desired.reportNameEn="Future revised component";
   if(entityType==="UNIT")desired.ucumCode="mg/dL";
   if(entityType==="CONTAINER")desired.tubeColor="lavender";
   if(entityType==="PANEL")desired.items=[{
     testId:id(76),displayOrder:1,required:true,test:{code:"C0"}}];
   if(entityType==="PACKAGE")desired.items=[{
     testId:id(76),displayOrder:1,test:{code:"C0"}}];
   if(entityType==="PRICE_LIST")desired.nameEn="Future tariff";
   if(entityType==="PRICE_LIST_ITEM"||entityType==="PRICE_LIST_PACKAGE_ITEM")
     desired.unitPrice="61.2500";
   if(entityType==="REFERENCE_INTERVAL")desired.criticalLow="2.000000";
   return {rowNumber:i+1,entityType,normalizedData:{id:x.id},
     scopedLiveData:x,sourceData:desired};
 });
 const liveHash=createHash("sha256");
 for(const row of rows){
   const token=catalogDriftObservationToken(secret,source.sourceChecksum,
     row.rowNumber,row.entityType,row.sourceData,row.scopedLiveData);
   liveHash.update(JSON.stringify([row.rowNumber,row.entityType,token]));
 }
 const context={organizationId:source.organizationId,batchId:source.batchId,
   branchId:source.branchId,authorUserId:source.authorUserId,
   sourceChecksum:source.sourceChecksum,
   stagedEvidenceDigest:source.stageEvidenceDigest,
   liveSnapshotDigest:liveHash.digest("hex"),
   policyDigest:source.policyDigest,effectiveAt:source.effectiveAt};
 const clinical=createCatalogApprovalEvidence(context,{
   revision:1,previousDigest:null,domain:"CLINICAL",decision:"APPROVE",
   signerUserId:id(6),mfaVerifiedAt:"2026-10-20T10:00:00.000Z",
   signedAt:"2026-10-20T10:01:00.000Z",
 },secret);
 const financial=createCatalogApprovalEvidence(context,{
   revision:2,previousDigest:clinical.digest,domain:"FINANCIAL",
   signerUserId:id(7),decision:"APPROVE",
   mfaVerifiedAt:"2026-10-20T10:01:00.000Z",
   signedAt:"2026-10-20T10:02:00.000Z",
 },secret);
 return {source,rows,mode:"APPLY",secret,
   now:new Date("2026-10-21T00:00:00.000Z"),
   approvals:[
     {id:id(8),actorUserId:id(6),branchId:source.branchId,newValues:clinical},
     {id:id(9),actorUserId:id(7),branchId:source.branchId,newValues:financial},
   ]};
}
function mockDb(){
 type Version={id:string;organizationId:string;sourceBatchId:string;
  sourceRowNumber:number;entityType:string;entityId:string;
  state:string;revision:number;effectiveFrom:Date;effectiveTo:Date|null;
  planDigest:string;originalDigest:string;desiredDigest:string;afterSnapshot:unknown};
 type Event={id:string;organizationId:string;action:string;
   entityType:string;entityId:string;newValues:unknown};
 const versions:Version[]=[],events:Event[]=[],writes:string[]=[];
 const input=build();
 let next=300;
 const audit={
   findMany:async(options:{where:Record<string,unknown>})=>{
     const w=options.where;
     return events.filter(e=>Object.entries(w).every(([key,val])=>{
       if(key==="id"&&val&&typeof val==="object"&&"in" in val)
         return (val as {in:string[]}).in.includes(e.id);
       return (e as unknown as Record<string,unknown>)[key]===val;
     }));
   },
   create:async({data}:{data:Omit<Event,"id">})=>{
     const evt={...data,id:id(next++)};events.push(evt);
     writes.push("AUDIT:"+evt.action);return {id:evt.id};
   },
 };
 const make=(key:string,oldId:string)=>({
   findMany:async()=>[{id:oldId}],
   findFirst:async()=>null,
   updateMany:async()=>{writes.push(key+":UPDATE");return {count:1};},
   create:async()=>{writes.push(key+":CREATE");return {id:randomUUID()};},
 });
 const versionTable={
   findMany:async(options:{where:Record<string,unknown>})=>{
     const w=options.where;
     return versions.filter(v=>Object.entries(w).every(([key,val])=>
       (v as unknown as Record<string,unknown>)[key]===val));
   },
   create:async({data}:{data:Omit<Version,"id">})=>{
     const version={...data,id:id(next++),effectiveTo:null};
     versions.push(version);writes.push("OVERLAY:CREATE");
     return {id:version.id};
   },
   updateMany:async({where,data}:{where:Record<string,unknown>;data:Record<string,unknown>})=>{
     const version=versions.find(v=>v.id===where.id);
     if(!version)return {count:0};
     if(where.state&&where.state!==version.state)return {count:0};
     Object.assign(version,data);writes.push("OVERLAY:UPDATE");
     return {count:1};
   },
 };
 const tx={
   $queryRaw:async(parts:TemplateStringsArray,...values:unknown[])=>{
     const query=parts.join("?");
     const read=(ident:string)=>{assert.equal(values[0],ident);return [{id:ident}];};
     if(query.includes("FROM test_components c JOIN lab_tests t"))
       return read(id(78));
     if(query.includes("FROM price_lists"))
       return [{...read(id(75))[0],branch_id:null}];
     if(query.includes("FROM lab_tests WHERE"))return read(id(76));
     if(query.includes("FROM commercial_packages WHERE"))return read(id(77));
     if(query.includes("FROM commercial_package_items"))return [];
     throw Error("unexpected_f2_ten_class_live_context");
   },
   auditEvent:audit,
   catalogImportBatch:{findFirst:async()=>({id:source.batchId})},
   catalogConfigurationRevision:versionTable,
   priceListItem:make("PRICE",id(38)),
   priceListPackageItem:make("PACKAGE_PRICE",id(39)),
   referenceInterval:make("RANGE",id(36)),
 };
 return {tx,versions,events,writes,input};
}
test("F2: ten changed classes pass one approved signed decision into three native versions and seven immutable overlays",async()=>{
 const db=mockDb();
 const outcome=await executeF2GovernedApplicationUnderLock(db.tx as never,db.input);
 assert.equal(outcome.state,"TEN_CLASS_CONFIGURATION_SCHEDULED");
 if(outcome.state!=="TEN_CLASS_CONFIGURATION_SCHEDULED")
   throw Error("expected mixed ten-class scheduled result");
 assert.equal(outcome.nativeChangedRows,3);
 assert.equal(outcome.masterChangedRows,7);
 assert.equal(db.versions.length,7);
 assert.equal(db.writes.filter(v=>v==="OVERLAY:CREATE").length,7);
 assert.equal(db.writes.filter(v=>v.endsWith(":CREATE")&&v!=="OVERLAY:CREATE").length,3);
 assert.ok(db.versions.every(v=>v.state==="RECORDED"&&v.effectiveFrom.toISOString()===effect));
 assert.ok(db.events.some(e=>e.action==="CATALOG_F2_EFFECTIVE_BATCH_APPLIED"));
 assert.equal(db.events.filter(e=>e.action==="CATALOG_F2_MASTER_REVISION_SCHEDULED").length,7);
 const before=db.writes.length;
 const again=await executeF2GovernedApplicationUnderLock(db.tx as never,db.input);
 assert.equal(again.state,"TEN_CLASS_CONFIGURATION_SCHEDULED");
 assert.equal(db.writes.length,before,"an exact re-submit creates no new masters or revisions");
});
test("F2: mixed governance rejects altered signer context before any SQL",async()=>{
 const base=mockDb().input;
 let reached=false;
 const tx={auditEvent:{findMany:async()=>{reached=true;throw Error("SQL called");}}};
 for(const mutation of [
   {...base,source:{...base.source,policyDigest:"f".repeat(64)}},
   {...base,source:{...base.source,sourceInstallationVerified:false as true}},
   {...base,rows:base.rows.map(row=>row.entityType==="UNIT"?
     {...row,sourceData:{...(row.sourceData as object),symbol:"BAD"}}:row)},
 ]){
   await assert.rejects(()=>executeF2GovernedApplicationUnderLock(
     tx as never,mutation),/f2_governed_/);
   assert.equal(reached,false);
 }
});
