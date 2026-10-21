import type {Prisma} from "../../generated/prisma/client";
import {verifyF2ApplyPlanIntegrity,type F2ApplyPlan} from "./catalog-f2-apply-plan.ts";
import type {F2EffectiveApplyAuthority} from "./catalog-f2-effective-versions.ts";
import {signF2ApplicationJournal,verifyF2ApplicationJournal}
  from "./catalog-f2-application-journal.ts";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const revisionTypes=new Set(["TEST","COMPONENT","UNIT","CONTAINER",
  "PANEL","PACKAGE","PRICE_LIST"]);
/**
 * Cancel only future-effective overlays. Never delete revisions or modify
 * the base master. After activation a new prospective correction is mandatory.
 * Tenant lock + independently revalidated author, signers and scoped stage
 * must be held throughout both this service and the native reversal.
 */
export async function cancelF2FutureMasterRevisionsUnderLock(
  tx:Prisma.TransactionClient,plan:F2ApplyPlan,
  authority:F2EffectiveApplyAuthority,now:Date,
  coordinatedNativeVersions=false,
):Promise<{state:"FUTURE_MASTER_REVISIONS_CANCELLED"|"FUTURE_MASTER_REVISIONS_ALREADY_CANCELLED";
  count:number}>{
  if(!verifyF2ApplyPlanIntegrity(plan)||
     ![authority.organizationId,authority.branchId,authority.batchId,
       authority.actorUserId,authority.clinicalSignerId,
       authority.financialSignerId].every(x=>UUID.test(x))||
     !authority.sourceInstallationVerified||
     !authority.qualifiedDomainSignersVerified||
     !authority.currentPermissionsAndBranchScopeVerified||
     !authority.signedStageAndLiveSnapshotVerified||
     !authority.journalSigningSecret||
     Buffer.byteLength(authority.journalSigningSecret,"utf8")<32 ||
     !Number.isFinite(now.getTime()))
    throw Error("f2_master_reversal_unauthorized");
  const at=new Date(plan.effectiveAt);
  if(!Number.isFinite(at.getTime())||now>=at)
    throw Error("f2_master_reversal_not_future");
  const allChanged=plan.rows.filter(r=>r.operation!=="UNCHANGED");
  if(allChanged.some(r=>!revisionTypes.has(r.entityType)) &&
     !coordinatedNativeVersions)
    throw Error("f2_master_reversal_requires_coordinator");
  const changed=allChanged.filter(r=>revisionTypes.has(r.entityType));
  if(!changed.length||changed.some(r=>![
    "SCALAR_VERSIONED_CHANGE","COMPOSITE_MEMBERSHIP_CHANGE"
  ].includes(r.operation)))throw Error("f2_master_reversal_wrong_operation");
  const existing=await tx.catalogConfigurationRevision.findMany({
    where:{organizationId:authority.organizationId,
      sourceBatchId:authority.batchId},
    select:{id:true,sourceRowNumber:true,entityType:true,entityId:true,
      state:true,revision:true,effectiveFrom:true,effectiveTo:true,
      originalDigest:true,desiredDigest:true,planDigest:true},
  });
  if(existing.length!==changed.length)
    throw Error("f2_master_reversal_missing_history");
  const matches=changed.map(row=>{
    const hit=existing.find(value=>value.sourceRowNumber===row.rowNumber &&
      value.entityType===row.entityType&&value.entityId===row.targetId &&
      value.originalDigest===row.originalDigest&&
      value.desiredDigest===row.desiredDigest&&
      value.planDigest===plan.planDigest&&
      value.effectiveFrom.getTime()===at.getTime());
    if(!hit)throw Error("f2_master_reversal_history_mismatch");
    return hit;
  });
  if(matches.every(x=>x.state==="CANCELLED"))
    return {state:"FUTURE_MASTER_REVISIONS_ALREADY_CANCELLED",
      count:changed.length};
  if(matches.some(x=>x.state!=="RECORDED"||x.effectiveTo!==null))
    throw Error("f2_master_reversal_partial_or_changed");
  for(const rev of matches){
    const row=changed.find(x=>x.rowNumber===rev.sourceRowNumber)!;
    const logs=await tx.auditEvent.findMany({
      where:{organizationId:authority.organizationId,
        action:"CATALOG_F2_MASTER_REVISION_SCHEDULED",
        entityType:row.entityType,entityId:row.targetId},
      select:{newValues:true},take:5001,
    });
    if(logs.length>5000)throw Error("f2_master_reversal_audit_overflow");
    const signed=logs.filter(entry=>{
      const value=verifyF2ApplicationJournal(entry.newValues,
        authority.journalSigningSecret);
      return value&&value.sourceBatchId===authority.batchId&&
        value.planDigest===plan.planDigest&&value.revisionId===rev.id&&
        value.originalDigest===row.originalDigest&&
        value.desiredDigest===row.desiredDigest&&
        value.rowNumber===row.rowNumber&&
        value.effectiveFrom===plan.effectiveAt;
    });
    if(signed.length!==1)
      throw Error("f2_master_reversal_unsigned_revision");
    const changedState=await tx.catalogConfigurationRevision.updateMany({
      where:{id:rev.id,organizationId:authority.organizationId,
        sourceBatchId:authority.batchId,state:"RECORDED",
        effectiveFrom:at,effectiveTo:null,revision:rev.revision,
        originalDigest:row.originalDigest,desiredDigest:row.desiredDigest,
        planDigest:plan.planDigest},
      data:{state:"CANCELLED",cancelledAt:now,
        cancelledByUserId:authority.actorUserId},
    });
    if(changedState.count!==1)throw Error("f2_master_reversal_concurrent_change");
    if(rev.revision>1){
      const opened=await tx.catalogConfigurationRevision.updateMany({
        where:{organizationId:authority.organizationId,
          entityType:row.entityType,entityId:row.targetId,
          revision:rev.revision-1,state:"RECORDED",
          effectiveTo:at},
        data:{effectiveTo:null},
      });
      if(opened.count!==1)throw Error("f2_master_reversal_predecessor_changed");
    }
    await tx.auditEvent.create({data:{
      organizationId:authority.organizationId,branchId:authority.branchId,
      actorUserId:authority.actorUserId,
      action:"CATALOG_F2_MASTER_REVISION_CANCELLED",
      entityType:row.entityType,entityId:row.targetId,
      newValues:signF2ApplicationJournal({
        sourceBatchId:authority.batchId,revisionId:rev.id,
        planDigest:plan.planDigest,effectiveFrom:plan.effectiveAt,
        cancelledAt:now.toISOString(),
      },authority.journalSigningSecret) as Prisma.InputJsonObject,
    }});
  }
  return {state:"FUTURE_MASTER_REVISIONS_CANCELLED",count:changed.length};
}
