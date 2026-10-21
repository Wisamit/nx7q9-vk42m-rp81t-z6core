import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {catalogExportTypes} from "../src/lib/catalog-configuration-export.ts";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {catalogDriftObservationToken} from "../src/lib/catalog-drift-triage.ts";
import {createCatalogApprovalEvidence} from "../src/lib/catalog-f2-approval-evidence.ts";
import {executeF2GovernedApplicationUnderLock,
  type F2GovernedExecutionInput} from "../src/lib/catalog-f2-governed-application.ts";

const uuid=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const secret="synthetic-verified-source-for-f2-application-only-secret-32";
const checksum="a".repeat(64),stageSeal="b".repeat(64),policy="c".repeat(64);
const now=new Date("2026-10-21T00:00:00.000Z");
const effectiveAt="2026-12-01T00:00:00.000Z";
const source={
  organizationId:uuid(1),branchId:uuid(2),batchId:uuid(3),
  authorUserId:uuid(4),actorUserId:uuid(5),sourceChecksum:checksum,
  stageEvidenceDigest:stageSeal,policyDigest:policy,effectiveAt,
  sourceInstallationVerified:true,fullyScopedStageVerified:true,
  fullDomainSignatoryGrantsCurrentlyVerified:true,
  currentOperatorScopesVerified:true,independentlyVerifiedInstallationMapping:true,
} as const;
const oldStart="2026-01-01T00:00:00.000Z";
function mockRows(){
  return [...catalogExportTypes].map((entityType,i)=>{
    const record:Record<string,unknown>={};
    for(const field of catalogBundleAllowedSourceFields[entityType])record[field]=null;
    record.id=uuid(100+i);record.createdAt=oldStart;
    record.updatedAt="2026-10-20T00:00:00.000Z";
    if(Object.hasOwn(record,"code"))record.code="TEST"+i;
    if(entityType==="REFERENCE_INTERVAL"){
      record.componentId=uuid(20);record.approvalStatus="APPROVED";
      record.status="ACTIVE";record.effectiveFrom=oldStart;
      record.effectiveTo=null;record.criticalLow="2.000000";
    }else if(entityType==="PRICE_LIST_ITEM"||
             entityType==="PRICE_LIST_PACKAGE_ITEM"){
      record.priceListId=uuid(21);
      if(entityType==="PRICE_LIST_ITEM")record.testId=uuid(22);
      else record.packageId=uuid(23);
      record.status="ACTIVE";record.effectiveFrom=oldStart;
      record.effectiveTo=null;record.unitPrice="12.5000";
    }
    const current=structuredClone(record);
    if(entityType==="PRICE_LIST_ITEM"||entityType==="PRICE_LIST_PACKAGE_ITEM")
      current.unitPrice="13.0000";
    if(entityType==="REFERENCE_INTERVAL")current.criticalLow="1.000000";
    return {rowNumber:i+1,entityType,sourceData:record,
      normalizedData:{id:record.id},scopedLiveData:current};
  });
}
function input():F2GovernedExecutionInput{
  const rows=mockRows(),digest=createHash("sha256");
  for(const row of rows){
    const token=catalogDriftObservationToken(secret,checksum,row.rowNumber,
      row.entityType,row.sourceData,row.scopedLiveData);
    digest.update(JSON.stringify([row.rowNumber,row.entityType,token]));
  }
  const context={
    organizationId:source.organizationId,batchId:source.batchId,
    branchId:source.branchId,authorUserId:source.authorUserId,
    sourceChecksum:source.sourceChecksum,stagedEvidenceDigest:stageSeal,
    liveSnapshotDigest:digest.digest("hex"),policyDigest:policy,effectiveAt,
  };
  const clinical=createCatalogApprovalEvidence(context,{
    revision:1,previousDigest:null,domain:"CLINICAL",
    signerUserId:uuid(6),mfaVerifiedAt:"2026-10-20T12:00:00.000Z",
    signedAt:"2026-10-20T12:01:00.000Z",decision:"APPROVE",
  },secret);
  const financial=createCatalogApprovalEvidence(context,{
    revision:2,previousDigest:clinical.digest,domain:"FINANCIAL",
    signerUserId:uuid(7),mfaVerifiedAt:"2026-10-20T12:01:00.000Z",
    signedAt:"2026-10-20T12:02:00.000Z",decision:"APPROVE",
  },secret);
  return {source,secret,now,mode:"APPLY",rows,approvals:[
    {id:uuid(8),actorUserId:clinical.signerUserId,
      branchId:source.branchId,newValues:clinical},
    {id:uuid(9),actorUserId:financial.signerUserId,
      branchId:source.branchId,newValues:financial},
  ]};
}
function txMock(){
  const writes:Array<{kind:string,args:unknown}>=[];
  const applied:Array<{id:string;newValues:unknown}>=[];
  let counter=500;
  const insert=async(kind:string,args:unknown)=>{
    writes.push({kind,args});
    const id=uuid(counter++);
    if(kind==="audit" &&
      (args as {data:{action:string}}).data.action==="CATALOG_F2_EFFECTIVE_BATCH_APPLIED")
      applied.push({id,newValues:(args as {data:{newValues:unknown}}).data.newValues});
    return {id};
  };
  const version=(kind:string)=>({
    findMany:async()=>[{id:kind==="price"?uuid(108):kind==="package"?uuid(109):uuid(106)}],
    create:async(args:unknown)=>insert(kind,args),
    updateMany:async(args:unknown)=>{writes.push({kind:kind+"-update",args});return {count:1};},
  });
  const price=version("price"),packagePrice=version("package");
  const range=version("range");
  return {writes,tx:{
    auditEvent:{
      findMany:async(args:{where:{action:string}})=>
        args.where.action==="CATALOG_F2_EFFECTIVE_BATCH_APPLIED"?applied:[],
      create:async(args:unknown)=>insert("audit",args),
    },
    priceListItem:price,priceListPackageItem:packagePrice,referenceInterval:range,
  }};
}
test("F2: two signed separate signers + exact 10-class source/live HMAC reach historical-safe mutation",async()=>{
  const request=input(),data=txMock();
  // Exercise the gate with a DB write stub that verifies authorization reaches
  // the version core, rather than assuming any HMAC implies a live approval.
  const target=request.rows.find(x=>x.entityType==="PRICE_LIST_ITEM")!;
  let changes=0;
  data.tx.priceListItem.findMany=async()=>[{id:target.scopedLiveData&&
    (target.scopedLiveData as {id:string}).id}];
  const packageTarget=request.rows.find(x=>x.entityType==="PRICE_LIST_PACKAGE_ITEM")!;
  data.tx.priceListPackageItem.findMany=async()=>[
    {id:(packageTarget.scopedLiveData as {id:string}).id}];
  const result=await executeF2GovernedApplicationUnderLock(
    data.tx as never,request);
  assert.equal(result.state,"EFFECTIVE_VERSIONS_APPLIED");
  assert.equal(result.changedRows,3);
  changes=data.writes.filter(x=>x.kind.endsWith("-update")).length;
  assert.equal(changes,3);
  assert.equal(data.writes.filter(x=>x.kind==="audit").length,4);
});
test("F2: a changed stage, sign decision, branch or live medical value rejects before SQL",async()=>{
  const baseline=input();
  const variants:F2GovernedExecutionInput[]=[
    {...baseline,source:{...source,sourceInstallationVerified:false as true}},
    {...baseline,source:{...source,independentlyVerifiedInstallationMapping:false as true}},
    {...baseline,source:{...source,fullDomainSignatoryGrantsCurrentlyVerified:false as true}},
    {...baseline,mode:"REVERSE"},
    {...baseline,source:{...source,organizationId:uuid(99)}},
    {...baseline,source:{...source,policyDigest:"f".repeat(64)}},
    {...baseline,source:{...source,stageEvidenceDigest:"f".repeat(64)}},
    {...baseline,source:{...source,effectiveAt:"2026-12-02T00:00:00.000Z"}},
    {...baseline,approvals:[baseline.approvals[0]]},
    {...baseline,approvals:[{...baseline.approvals[0],actorUserId:uuid(77)},baseline.approvals[1]]},
    {...baseline,rows:baseline.rows.slice(1)},
    {...baseline,rows:baseline.rows.map(row=>row.entityType==="REFERENCE_INTERVAL"?
      {...row,scopedLiveData:{...(row.scopedLiveData as object),criticalLow:"7.000000"}}:row)},
    {...baseline,rows:baseline.rows.map(row=>row.entityType==="PRICE_LIST_ITEM"?
      {...row,sourceData:{...(row.sourceData as object),unitPrice:"0.0000"}}:row)},
  ];
  for(const variant of variants){
    let reads=0;
    const tx={auditEvent:{findMany:async()=>{reads++;throw Error("SQL reached");}}};
    await assert.rejects(()=>executeF2GovernedApplicationUnderLock(
      tx as never,variant),/f2_governed_/);
    assert.equal(reads,0);
  }
});
