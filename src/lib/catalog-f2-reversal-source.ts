import type { Prisma } from "../../generated/prisma/client";
import type { F2ApplySourceRow } from "./catalog-f2-apply-plan.ts";
import { verifyF2ApplicationJournal } from "./catalog-f2-application-journal.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const obj=(x:unknown):x is Record<string,unknown> =>
  x!==null && typeof x==="object"&&!Array.isArray(x);
const NATIVE=new Set(["REFERENCE_INTERVAL","PRICE_LIST_ITEM","PRICE_LIST_PACKAGE_ITEM"]);

/**
 * Recover ORIGINAL pre-apply live observations from the independent
 * application-journal HMAC chain, not HTTP input or already-modified SQL rows.
 * All records are loaded inside the same tenant-locked transaction as the
 * future reversal. A master-only revision is also supported.
 *
 * The governed application service later reconstructs the original approved
 * liveSnapshotDigest and entire plan, and performs CAS against every target.
 * A missing/tampered signed journal makes reversal unavailable.
 */
export async function recoverF2PreApplyObservationsUnderLock(
  tx:Prisma.TransactionClient,input:{
    organizationId:string;branchId:string;batchId:string;
    secret:string;rows:readonly F2ApplySourceRow[];
    now:Date;
  },
):Promise<ReadonlyArray<F2ApplySourceRow>|null>{
  const {organizationId,branchId,batchId,secret,rows,now}=input;
  if(![organizationId,branchId,batchId].every(v=>UUID.test(v))||
     typeof secret!=="string"||Buffer.byteLength(secret,"utf8")<32||
     !Number.isFinite(now.getTime())||!rows.length||rows.length>5000)
    return null;
  const batches=await tx.auditEvent.findMany({
    where:{organizationId,entityType:"CatalogImportBatch",entityId:batchId,
      action:"CATALOG_F2_EFFECTIVE_BATCH_APPLIED"},
    take:2,select:{id:true,branchId:true,newValues:true},
  });
  if(batches.length>1)return null;
  const frozen=new Map<string,Record<string,unknown>>();
  if(batches.length){
    const batch=batches[0];
    if(batch.branchId!==branchId)return null;
    const saved=verifyF2ApplicationJournal(batch.newValues,secret);
    if(!saved||saved.organizationId!==organizationId||
       saved.batchId!==batchId||!SHA.test(String(saved.planDigest))||
       typeof saved.effectiveAt!=="string"||
       !Number.isFinite(Date.parse(saved.effectiveAt))||
       now.getTime()>=Date.parse(saved.effectiveAt)||
       !Array.isArray(saved.journalEventIds)||
       !Array.isArray(saved.createdVersionIds)||
       !saved.journalEventIds.length||
       saved.journalEventIds.length!==saved.createdVersionIds.length||
       saved.journalEventIds.length>5000||
       saved.journalEventIds.some(x=>typeof x!=="string"||!UUID.test(x))||
       saved.createdVersionIds.some(x=>typeof x!=="string"||!UUID.test(x))||
       new Set(saved.journalEventIds).size!==saved.journalEventIds.length||
       new Set(saved.createdVersionIds).size!==saved.createdVersionIds.length)
      return null;
    const events=await tx.auditEvent.findMany({
      where:{organizationId,id:{in:saved.journalEventIds as string[]},
        action:"CATALOG_F2_VERSION_CLONED"},
      select:{id:true,entityType:true,entityId:true,branchId:true,newValues:true},
    });
    if(events.length!==saved.journalEventIds.length)return null;
    const recordIds=new Set<string>();
    const cloned=new Set<string>();
    for(const event of events){
      if(recordIds.has(event.id)||event.branchId!==branchId||
         !NATIVE.has(event.entityType)||!UUID.test(event.entityId))
        return null;
      recordIds.add(event.id);
      const values=verifyF2ApplicationJournal(event.newValues,secret);
      if(!values||values.batchId!==batchId||
         values.planDigest!==saved.planDigest||
         values.effectiveAt!==saved.effectiveAt||
         !obj(values.before)||!obj(values.after)||
         values.before.id!==event.entityId||
         values.after.id!==event.entityId||
         !SHA.test(String(values.originalDigest))||
         !SHA.test(String(values.desiredDigest))||
         typeof values.newVersionId!=="string"||
         !UUID.test(values.newVersionId)||
         !saved.createdVersionIds.includes(values.newVersionId)||
         cloned.has(values.newVersionId))
        return null;
      cloned.add(values.newVersionId);
      const key=event.entityType+":"+event.entityId;
      if(frozen.has(key))return null;
      frozen.set(key,values.before);
    }
    if(cloned.size!==saved.createdVersionIds.length)return null;
  }
  const masters=await tx.catalogConfigurationRevision.findMany({
    where:{organizationId,sourceBatchId:batchId},
    select:{id:true,branchId:true,sourceRowNumber:true,entityType:true,
      entityId:true,planDigest:true,originalDigest:true,desiredDigest:true},
    take:5001,
  });
  if(masters.length>5000||
     masters.some(m=>m.branchId!==branchId||
       !UUID.test(m.entityId)||!SHA.test(m.planDigest)||
       !SHA.test(m.originalDigest)||!SHA.test(m.desiredDigest)||
       !rows.some(row=>row.rowNumber===m.sourceRowNumber&&
         row.entityType===m.entityType&&
         obj(row.normalizedData)&&row.normalizedData.id===m.entityId)))
    return null;
  if(!frozen.size&&!masters.length)return null;
  const keys=new Set(rows.map(row=>{
    const d=obj(row.normalizedData)?row.normalizedData:null;
    return row.entityType+":"+(d?.id??"");
  }));
  if([...frozen.keys()].some(key=>!keys.has(key)))return null;
  return rows.map(row=>{
    const d=obj(row.normalizedData)?row.normalizedData:null;
    const before=frozen.get(row.entityType+":"+(d?.id??""));
    return before?{...row,scopedLiveData:before}:row;
  });
}
