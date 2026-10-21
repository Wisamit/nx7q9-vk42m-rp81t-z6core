import {createHash,timingSafeEqual} from "node:crypto";
import type {Prisma} from "../../generated/prisma/client";
import {canonicalJson,type Json} from "./catalog-bundle-attestation.ts";
import {verifyF2ApplyPlanIntegrity,type F2ApplyPlan} from "./catalog-f2-apply-plan.ts";
import type {F2EffectiveApplyAuthority} from "./catalog-f2-effective-versions.ts";
import {signF2ApplicationJournal} from "./catalog-f2-application-journal.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const revisionTypes=new Set(["TEST","COMPONENT","UNIT","CONTAINER",
  "PANEL","PACKAGE","PRICE_LIST"]);
const item=(v:unknown):v is Record<string,unknown>=>!!v&&
  typeof v==="object"&&!Array.isArray(v);
const same=(a:unknown,b:unknown)=>{
  try{return canonicalJson(a as Json)===canonicalJson(b as Json);}
  catch{return false;}
};
const SHA=/^[0-9a-f]{64}$/;
function matchesSnapshotDigest(snapshot:unknown,digest:unknown){
  if(!SHA.test(String(digest)))return false;
  try{
    const current=createHash("sha256").update(
      canonicalJson(snapshot as Json)).digest();
    return timingSafeEqual(current,Buffer.from(digest as string,"hex"));
  }catch{return false;}
}
function guard(plan:F2ApplyPlan,auth:F2EffectiveApplyAuthority,now:Date,
  coordinatedNativeVersions=false){
  if(!verifyF2ApplyPlanIntegrity(plan)||
     ![auth.organizationId,auth.branchId,auth.batchId,
       auth.actorUserId,auth.clinicalSignerId,auth.financialSignerId].every(x=>UUID.test(x))||
     new Set([auth.actorUserId,auth.clinicalSignerId,auth.financialSignerId]).size!==3||
     !auth.sourceInstallationVerified||
     !auth.qualifiedDomainSignersVerified||
     !auth.currentPermissionsAndBranchScopeVerified||
     !auth.signedStageAndLiveSnapshotVerified ||
     !auth.journalSigningSecret||
     Buffer.byteLength(auth.journalSigningSecret,"utf8")<32||
     !Number.isFinite(now.getTime()))
    throw Error("f2_master_revision_unauthorized");
  const startsAt=new Date(plan.effectiveAt);
  if(!Number.isFinite(startsAt.getTime())||startsAt<=now)
    throw Error("f2_master_revision_requires_future_date");
  const allChanged=plan.rows.filter(row=>row.operation!=="UNCHANGED");
  if(allChanged.some(row=>!revisionTypes.has(row.entityType)) &&
     !coordinatedNativeVersions)
    throw Error("f2_master_revision_unhandled_changed_class");
  const changed=allChanged.filter(row=>revisionTypes.has(row.entityType));
  if(!changed.length || changed.some(row=>
     !["SCALAR_VERSIONED_CHANGE","COMPOSITE_MEMBERSHIP_CHANGE"]
        .includes(row.operation)))
    throw Error("f2_master_revision_unhandled_changed_class");
  return {changed,startsAt};
}
/**
 * Schedules non-native-versioned masters as tenant-scoped immutable
 * effective snapshots. Does NOT overwrite stable existing master IDs,
 * memberships, historic clinical ranges, or historic issued prices.
 *
 * The reader must resolve effective snapshots using
 * resolveF2CatalogMasterAsOf() before consuming future configuration.
 * The caller owns a tenant FOR UPDATE lock and scope/signatory verification
 * from the current DB snapshot; no HTTP request may supply auth booleans.
 */
export async function recordF2CatalogMasterRevisionsUnderLock(
  tx:Prisma.TransactionClient,plan:F2ApplyPlan,
  auth:F2EffectiveApplyAuthority,now:Date,
  coordinatedNativeVersions=false,
):Promise<{state:"MASTER_REVISIONS_RECORDED"|"MASTER_REVISIONS_ALREADY_RECORDED";
  count:number;revisionIds:readonly string[]}>{
  const {changed,startsAt}=guard(plan,auth,now,coordinatedNativeVersions);
  const batch=await tx.catalogImportBatch.findFirst({
    where:{id:auth.batchId,organizationId:auth.organizationId,
      sourceType:"CONFIG_BUNDLE_REVIEW",status:"DRAFT"},
    select:{id:true},
  });
  if(!batch)throw Error("f2_master_revision_batch_not_found");
  const existing=await tx.catalogConfigurationRevision.findMany({
    where:{organizationId:auth.organizationId,sourceBatchId:auth.batchId},
    select:{id:true,sourceRowNumber:true,planDigest:true,
      originalDigest:true,desiredDigest:true,effectiveFrom:true,state:true},
  });
  if(existing.length){
    if(existing.length!==changed.length||
       changed.some(row=>!existing.some(x=>
         x.sourceRowNumber===row.rowNumber&&
         x.planDigest===plan.planDigest&&
         x.originalDigest===row.originalDigest&&
         x.desiredDigest===row.desiredDigest&&
         x.effectiveFrom.getTime()===startsAt.getTime()&&
         x.state==="RECORDED")))
      throw Error("f2_master_revision_batch_conflict");
    return {state:"MASTER_REVISIONS_ALREADY_RECORDED",
      count:changed.length,revisionIds:existing.map(x=>x.id)};
  }
  const createdIds:string[]=[];
  for(const row of changed){
    if(!item(row.originalSnapshot)||!item(row.desiredSnapshot)||
       row.originalSnapshot.id!==row.targetId||
       row.desiredSnapshot.id!==row.targetId)
      throw Error("f2_master_revision_invalid_snapshots");
    const prior=await tx.catalogConfigurationRevision.findMany({
      where:{organizationId:auth.organizationId,entityType:row.entityType,
        entityId:row.targetId,state:"RECORDED"},
      orderBy:{revision:"desc"},take:2,
      select:{id:true,revision:true,effectiveFrom:true,effectiveTo:true,
        afterSnapshot:true,desiredDigest:true},
    });
    if(prior.length>1 && prior[1].revision===prior[0].revision)
      throw Error("f2_master_revision_history_corrupt");
    const latest=prior[0]??null;
    if(latest && (latest.effectiveFrom>=startsAt||
       latest.effectiveFrom>now||
       latest.effectiveTo!==null||
       !matchesSnapshotDigest(latest.afterSnapshot,latest.desiredDigest)||
       !same(latest.afterSnapshot,row.originalSnapshot)))
      throw Error("f2_master_revision_prior_version_conflict");
    if(latest){
      const close=await tx.catalogConfigurationRevision.updateMany({
        where:{id:latest.id,organizationId:auth.organizationId,
          entityType:row.entityType,entityId:row.targetId,
          revision:latest.revision,effectiveTo:null,state:"RECORDED"},
        data:{effectiveTo:startsAt},
      });
      if(close.count!==1)
        throw Error("f2_master_revision_concurrent_change");
    }
    const result=await tx.catalogConfigurationRevision.create({data:{
      organizationId:auth.organizationId,branchId:auth.branchId,
      sourceBatchId:auth.batchId,sourceRowNumber:row.rowNumber,
      entityType:row.entityType,entityId:row.targetId,
      revision:latest?latest.revision+1:1,
      effectiveFrom:startsAt,state:"RECORDED",
      beforeSnapshot:row.originalSnapshot as Prisma.InputJsonObject,
      afterSnapshot:row.desiredSnapshot as Prisma.InputJsonObject,
      originalDigest:row.originalDigest,desiredDigest:row.desiredDigest,
      planDigest:plan.planDigest,createdByUserId:auth.actorUserId,
      clinicalSignerUserId:auth.clinicalSignerId,
      financialSignerUserId:auth.financialSignerId,
    },select:{id:true}});
    createdIds.push(result.id);
    await tx.auditEvent.create({data:{
      organizationId:auth.organizationId,branchId:auth.branchId,
      actorUserId:auth.actorUserId,action:"CATALOG_F2_MASTER_REVISION_SCHEDULED",
      entityType:row.entityType,entityId:row.targetId,
      newValues:signF2ApplicationJournal({
        sourceBatchId:auth.batchId,planDigest:plan.planDigest,
        targetId:row.targetId,revisionId:result.id,
        rowNumber:row.rowNumber,effectiveFrom:plan.effectiveAt,
        originalDigest:row.originalDigest,desiredDigest:row.desiredDigest,
      },auth.journalSigningSecret) as Prisma.InputJsonObject,
    }});
  }
  return {state:"MASTER_REVISIONS_RECORDED",count:changed.length,
    revisionIds:createdIds};
}
/** Returns only the effective overlay, or null to use the original master. */
export async function resolveF2CatalogMasterAsOf(
  tx:Prisma.TransactionClient,scope:{
    organizationId:string;entityType:string;entityId:string;asOf:Date;
  },
):Promise<Readonly<Record<string,unknown>>|null>{
  if(!UUID.test(scope.organizationId)||!UUID.test(scope.entityId)||
     !revisionTypes.has(scope.entityType)||
     !Number.isFinite(scope.asOf.getTime()))
    throw Error("f2_master_revision_lookup_invalid");
  const matches=await tx.catalogConfigurationRevision.findMany({
    where:{organizationId:scope.organizationId,entityType:scope.entityType,
      entityId:scope.entityId,state:"RECORDED",
      effectiveFrom:{lte:scope.asOf},
      OR:[{effectiveTo:null},{effectiveTo:{gt:scope.asOf}}]},
    select:{afterSnapshot:true,desiredDigest:true},take:2,orderBy:{revision:"desc"},
  });
  if(matches.length>1)throw Error("f2_master_revision_overlapping_effective_period");
  const snapshot=matches[0]?.afterSnapshot;
  if(snapshot===undefined)return null;
  if(!item(snapshot)||snapshot.id!==scope.entityId||
     !matchesSnapshotDigest(snapshot,matches[0].desiredDigest))
    throw Error("f2_master_revision_snapshot_corrupt");
  return snapshot;
}
