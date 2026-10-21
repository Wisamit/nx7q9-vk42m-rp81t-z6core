import type { Prisma } from "../../generated/prisma/client";
import { verifyF2ApplyPlanIntegrity, type F2ApplyPlan } from "./catalog-f2-apply-plan.ts";
import type { F2EffectiveApplyAuthority } from "./catalog-f2-effective-versions.ts";
import { f2ReferenceIntervalCasWhere } from "./catalog-f2-effective-versions.ts";
import {
  signF2ApplicationJournal,verifyF2ApplicationJournal,
} from "./catalog-f2-application-journal.ts";

const obj=(v:unknown):v is Record<string,unknown> =>
  !!v && typeof v==="object"&&!Array.isArray(v);
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type F2EffectiveReversalResult={
  state:"FUTURE_EFFECTIVE_VERSIONS_REVERSED"|"FUTURE_VERSIONS_ALREADY_REVERSED";
  changedRows:number;batchId:string;
};
/**
 * Pre-effective-date compensating reversal: keeps the newly created versions
 * and the original versions in SQL, retires the never-effective clones, and
 * restores the original end-date. No clinical result/order FK is deleted.
 *
 * Retroactive reversal is deliberately not performed: after activation a new
 * prospective correction version is required to avoid rewriting history.
 * Caller retains the same tenant row lock, live scopes and signer grants.
 */
export async function reverseF2FutureEffectiveVersionsUnderLock(
  tx:Prisma.TransactionClient,plan:F2ApplyPlan,
  authority:F2EffectiveApplyAuthority,now:Date,
  coordinatedMasterRevisions=false,
):Promise<F2EffectiveReversalResult>{
  if(!verifyF2ApplyPlanIntegrity(plan)||
     !UUID.test(authority.organizationId)||!UUID.test(authority.branchId)||
     !UUID.test(authority.batchId)||!UUID.test(authority.actorUserId)||
     !authority.journalSigningSecret||
     Buffer.byteLength(authority.journalSigningSecret,"utf8")<32||
     !authority.sourceInstallationVerified||
     !authority.qualifiedDomainSignersVerified||
     !authority.currentPermissionsAndBranchScopeVerified||
     !authority.signedStageAndLiveSnapshotVerified ||
     !Number.isFinite(now.getTime()))
    throw Error("f2_reversal_unauthorized");
  const allChanged=plan.rows.filter(row=>row.operation!=="UNCHANGED");
  if(allChanged.some(row=>row.operation!=="EFFECTIVE_DATED_NEW_VERSION") &&
     !coordinatedMasterRevisions)
    throw Error("f2_reversal_other_class_support_pending");
  const nativeChanges=allChanged.filter(row=>
    row.operation==="EFFECTIVE_DATED_NEW_VERSION");
  if(!nativeChanges.length)throw Error("f2_reversal_no_native_version_changes");
  const at=new Date(plan.effectiveAt);
  if(!Number.isFinite(at.getTime())||now.getTime()>=at.getTime())
    throw Error("f2_reversal_requires_pre_effective_date");
  const reversed=await tx.auditEvent.findMany({
    where:{organizationId:authority.organizationId,action:"CATALOG_F2_EFFECTIVE_BATCH_REVERSED",
      entityType:"CatalogImportBatch",entityId:authority.batchId},
    take:2,select:{newValues:true},
  });
  if(reversed.length>1)throw Error("f2_reversal_duplicate_journal");
  if(reversed.length){
    const journal=verifyF2ApplicationJournal(
      reversed[0].newValues,authority.journalSigningSecret);
    if(!journal||journal.planDigest!==plan.planDigest)
      throw Error("f2_reversal_journal_mismatch");
    return {state:"FUTURE_VERSIONS_ALREADY_REVERSED",
      changedRows:nativeChanges.length,batchId:authority.batchId};
  }
  const applied=await tx.auditEvent.findMany({
    where:{organizationId:authority.organizationId,action:"CATALOG_F2_EFFECTIVE_BATCH_APPLIED",
      entityType:"CatalogImportBatch",entityId:authority.batchId},
    take:2,select:{newValues:true},
  });
  const applyRecord=applied.length===1?
    verifyF2ApplicationJournal(
      applied[0].newValues,authority.journalSigningSecret):null;
  if(!applyRecord ||
     applyRecord.planDigest!==plan.planDigest ||
     applyRecord.effectiveAt!==plan.effectiveAt ||
     !Array.isArray(applyRecord.journalEventIds) ||
     !Array.isArray(applyRecord.createdVersionIds) ||
     applyRecord.journalEventIds.length!==nativeChanges.length ||
     applyRecord.createdVersionIds.length!==nativeChanges.length)
    throw Error("f2_reversal_missing_applied_journal");
  const ids=applyRecord.journalEventIds as unknown[];
  if(ids.some(id=>typeof id!=="string"||!UUID.test(id))||
     new Set(ids).size!==ids.length)
    throw Error("f2_reversal_invalid_journal_ids");
  const journals=await tx.auditEvent.findMany({
    where:{organizationId:authority.organizationId,id:{in:ids as string[]},
      action:"CATALOG_F2_VERSION_CLONED"},
    select:{id:true,entityType:true,entityId:true,newValues:true},
  });
  if(journals.length!==ids.length)
    throw Error("f2_reversal_incomplete_journal");
  const byId=new Map(journals.map(event=>[event.entityType+":"+event.entityId,event]));
  // Both manual tariff versions and clinical interval approvals use
  // inclusive effectiveTo; all three predecessors close one millisecond
  // BEFORE a newly scheduled effectiveFrom timestamp.
  const predecessorCloseAt=new Date(at.getTime()-1);
  for(const row of nativeChanges){
    const journal=byId.get(row.entityType+":"+row.targetId);
    const values=journal?verifyF2ApplicationJournal(
      journal.newValues,authority.journalSigningSecret):null;
    if(!journal||!values ||
       values.planDigest!==plan.planDigest ||
       values.batchId!==authority.batchId||
       values.effectiveAt!==plan.effectiveAt ||
       values.originalDigest!==row.originalDigest ||
       values.desiredDigest!==row.desiredDigest ||
       !obj(values.before)||!obj(values.after) ||
       values.before.id!==row.originalSnapshot.id ||
       values.after.id!==row.desiredSnapshot.id ||
       typeof values.newVersionId!=="string" ||
       !UUID.test(values.newVersionId))
      throw Error("f2_reversal_journal_tampered");
    const newId=values.newVersionId;
    const parentId=row.targetId;
    if(row.entityType==="PRICE_LIST_ITEM"){
      const referenced=await tx.priceListItem.findFirst({
        where:{id:newId,orderItems:{some:{}}},select:{id:true},
      });
      if(referenced)throw Error("f2_reversal_price_historically_referenced");
      const retired=await tx.priceListItem.updateMany({
        where:{id:newId,unitPrice:row.desiredSnapshot.unitPrice as string,
          effectiveFrom:at,effectiveTo:null,status:"ACTIVE"},
        data:{status:"INACTIVE",effectiveTo:at,deactivatedAt:now},
      });
      if(retired.count!==1)throw Error("f2_reversal_new_price_changed");
      const restored=await tx.priceListItem.updateMany({
        where:{id:parentId,effectiveTo:predecessorCloseAt,status:"ACTIVE",
          unitPrice:row.originalSnapshot.unitPrice as string,
          effectiveFrom:new Date(row.originalSnapshot.effectiveFrom as string)},
        data:{effectiveTo:null},
      });
      if(restored.count!==1)throw Error("f2_reversal_old_price_changed");
    }else if(row.entityType==="PRICE_LIST_PACKAGE_ITEM"){
      const referenced=await tx.priceListPackageItem.findFirst({
        where:{id:newId,orderPackages:{some:{}}},select:{id:true},
      });
      if(referenced)throw Error("f2_reversal_package_historically_referenced");
      const retired=await tx.priceListPackageItem.updateMany({
        where:{id:newId,unitPrice:row.desiredSnapshot.unitPrice as string,
          effectiveFrom:at,effectiveTo:null,status:"ACTIVE"},
        data:{status:"INACTIVE",effectiveTo:at,deactivatedAt:now},
      });
      if(retired.count!==1)throw Error("f2_reversal_new_package_changed");
      const restored=await tx.priceListPackageItem.updateMany({
        where:{id:parentId,effectiveTo:predecessorCloseAt,status:"ACTIVE",
          unitPrice:row.originalSnapshot.unitPrice as string,
          effectiveFrom:new Date(row.originalSnapshot.effectiveFrom as string)},
        data:{effectiveTo:null},
      });
      if(restored.count!==1)throw Error("f2_reversal_old_package_changed");
    }else if(row.entityType==="REFERENCE_INTERVAL"){
      const referenced=await tx.referenceInterval.findFirst({
        where:{id:newId,resultValues:{some:{}}},select:{id:true},
      });
      if(referenced)throw Error("f2_reversal_range_historically_referenced");
      const retired=await tx.referenceInterval.updateMany({
        where:{id:newId,effectiveFrom:at,effectiveTo:null,
          status:"ACTIVE",approvalStatus:"APPROVED"},
        data:{status:"INACTIVE",approvalStatus:"RETIRED",
          effectiveTo:at,retiredAt:now,
          retiredByUserId:authority.actorUserId,
          retirementReason:"F2_PRE_EFFECTIVE_COMPENSATING_REVERSAL"},
      });
      if(retired.count!==1)throw Error("f2_reversal_new_range_changed");
      const restored=await tx.referenceInterval.updateMany({
        where:{id:parentId,effectiveTo:at,status:"ACTIVE",
          approvalStatus:"APPROVED",
          effectiveFrom:new Date(row.originalSnapshot.effectiveFrom as string),
          ...f2ReferenceIntervalCasWhere(row.originalSnapshot)},
        data:{effectiveTo:null},
      });
      if(restored.count!==1)throw Error("f2_reversal_old_range_changed");
    }else throw Error("f2_reversal_unrecognized_operation");
    await tx.auditEvent.create({data:{
      organizationId:authority.organizationId,branchId:authority.branchId,
      actorUserId:authority.actorUserId,
      action:"CATALOG_F2_EFFECTIVE_VERSION_REVERSED",
      entityType:row.entityType,entityId:parentId,
      newValues:signF2ApplicationJournal({
        batchId:authority.batchId,planDigest:plan.planDigest,
        retiredNeverEffectiveVersionId:newId,effectiveAt:plan.effectiveAt,
      },authority.journalSigningSecret) as Prisma.InputJsonObject,
    }});
  }
  await tx.auditEvent.create({data:{
    organizationId:authority.organizationId,branchId:authority.branchId,
    actorUserId:authority.actorUserId,
    entityType:"CatalogImportBatch",entityId:authority.batchId,
    action:"CATALOG_F2_EFFECTIVE_BATCH_REVERSED",
    newValues:signF2ApplicationJournal({
      planDigest:plan.planDigest,effectiveAt:plan.effectiveAt,
      changedRows:nativeChanges.length,reason:"FUTURE_VERSION_COMPENSATION",
    },authority.journalSigningSecret) as Prisma.InputJsonObject,
  }});
  return {state:"FUTURE_EFFECTIVE_VERSIONS_REVERSED",
    changedRows:nativeChanges.length,batchId:authority.batchId};
}
