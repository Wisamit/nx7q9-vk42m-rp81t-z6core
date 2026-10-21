import {createHash} from "node:crypto";
import type {Prisma} from "../../generated/prisma/client";
import {catalogExportTypes} from "./catalog-configuration-export.ts";
import {catalogDriftObservationToken} from "./catalog-drift-triage.ts";
import {compileF2ApplyPlan,type F2ApplySourceRow} from "./catalog-f2-apply-plan.ts";
import {verifyCatalogApprovalHistory,
  type CatalogApprovalAuditEvent,type CatalogApprovalContext} from "./catalog-f2-approval-evidence.ts";
import {applyF2EffectiveVersionsUnderLock,
  type F2EffectiveApplyResult,type F2EffectiveApplyAuthority} from "./catalog-f2-effective-versions.ts";
import {reverseF2FutureEffectiveVersionsUnderLock,
  type F2EffectiveReversalResult} from "./catalog-f2-effective-reversal.ts";
import {recordF2CatalogMasterRevisionsUnderLock}
  from "./catalog-f2-master-revisions.ts";
import {cancelF2FutureMasterRevisionsUnderLock}
  from "./catalog-f2-master-reversal.ts";

const SHA=/^[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Mode="APPLY"|"REVERSE";
type VerifiedSource={
  organizationId:string;branchId:string;batchId:string;
  authorUserId:string;actorUserId:string;
  sourceChecksum:string;stageEvidenceDigest:string;policyDigest:string;
  effectiveAt:string;
  /** These guarantees are derived by the server INSIDE the tenant lock. */
  sourceInstallationVerified:true;
  fullyScopedStageVerified:true;
  fullDomainSignatoryGrantsCurrentlyVerified:true;
  currentOperatorScopesVerified:true;
  independentlyVerifiedInstallationMapping:true;
  /**
   * For compensation only: server has authenticated the signed apply journal,
   * checked exact future cloned versions and retained its frozen pre-apply
   * observation. Live post-apply rows are necessarily NOT that observation.
   */
  appliedVersionJournalValidated?:true;
};
export type F2GovernedExecutionInput={
  source:VerifiedSource;mode:Mode;now:Date;secret:string;
  rows:readonly F2ApplySourceRow[];
  approvals:readonly CatalogApprovalAuditEvent[];
};

/**
 * Binds the same TEN-class live staged bytes checked by the technical
 * signers to the exact journaled version plan before executing SQL.
 *
 * Internal transaction service only. The caller must acquire a tenant
 * organization FOR UPDATE lock and independently validate branch/department
 * grants, sealed staging, installation provenance and both role signers
 * from the database in THAT SAME transaction. Never accept a JSON request
 * as VerifiedSource.
 *
 * Only effective-dated prices and clinical ranges can currently mutate:
 * unsupported changed master classes fail BEFORE attempting any SQL write.
 */
export async function executeF2GovernedApplicationUnderLock(
  tx:Prisma.TransactionClient,input:F2GovernedExecutionInput,
):Promise<F2EffectiveApplyResult|F2EffectiveReversalResult|{
  state:"TEN_CLASS_CONFIGURATION_SCHEDULED"|"TEN_CLASS_CONFIGURATION_REVERSED";
  nativeChangedRows:number;masterChangedRows:number;
  nativeVersionIds:readonly string[];masterRevisionIds:readonly string[];
}>{
  const {source,secret,now,rows,approvals,mode}=input;
  if(!["APPLY","REVERSE"].includes(mode) ||
    !Number.isFinite(now.getTime()) ||
    !secret||Buffer.byteLength(secret,"utf8")<32 ||
    !source.sourceInstallationVerified ||
    !source.independentlyVerifiedInstallationMapping ||
    !source.fullyScopedStageVerified ||
    !source.fullDomainSignatoryGrantsCurrentlyVerified ||
    !source.currentOperatorScopesVerified ||
    (mode==="REVERSE" && source.appliedVersionJournalValidated!==true) ||
    ![source.organizationId,source.branchId,source.batchId,
      source.authorUserId,source.actorUserId].every(id=>UUID.test(id)) ||
    ![source.sourceChecksum,source.stageEvidenceDigest,source.policyDigest]
      .every(value=>SHA.test(value)) ||
    rows.length<10 || rows.length>5000)
    throw Error("f2_governed_application_not_authorized");

  // All ten native types MUST be represented. A partial review bundle is
  // not evidence of full catalog sign-off.
  const covered=new Set(rows.map(row=>row.entityType));
  if(covered.size!==catalogExportTypes.size ||
    [...catalogExportTypes].some(type=>!covered.has(type)))
    throw Error("f2_governed_ten_class_stage_required");

  // APPLY: caller must re-read current live rows under tenant lock.
  // REVERSE: caller must use the frozen, HMAC-authenticated PRE-APPLY
  // observation bound to the approved journal; the reversal CAS separately
  // checks post-apply cloned versions and rejects already-used records.
  // Both modes must match precisely the originally approved source snapshot.
  const liveHash=createHash("sha256");
  for(const [index,row] of rows.entries()){
    if(row.rowNumber!==index+1 ||
      !catalogExportTypes.has(row.entityType as never) ||
      typeof row.sourceData!=="object"||row.sourceData===null ||
      typeof row.scopedLiveData!=="object"||row.scopedLiveData===null)
      throw Error("f2_governed_invalid_staged_row");
    const digest=catalogDriftObservationToken(secret,source.sourceChecksum,
      row.rowNumber,row.entityType,row.sourceData,row.scopedLiveData);
    liveHash.update(JSON.stringify([row.rowNumber,row.entityType,digest]));
  }
  const context:CatalogApprovalContext={
    organizationId:source.organizationId,batchId:source.batchId,
    branchId:source.branchId,authorUserId:source.authorUserId,
    sourceChecksum:source.sourceChecksum,
    stagedEvidenceDigest:source.stageEvidenceDigest,
    liveSnapshotDigest:liveHash.digest("hex"),
    policyDigest:source.policyDigest,effectiveAt:source.effectiveAt,
  };
  const verified=verifyCatalogApprovalHistory({context,events:approvals,secret});
  if(!verified||!verified.technicallyApproved||
    !verified.clinical||!verified.financial||
    verified.clinical.signerUserId===verified.financial.signerUserId||
    [verified.clinical.signerUserId,verified.financial.signerUserId]
      .includes(source.actorUserId) ||
    source.actorUserId===source.authorUserId)
    throw Error("f2_governed_signed_approvals_invalid");

  const plan=compileF2ApplyPlan({
    rows,effectiveAt:source.effectiveAt,
    signedStageVerified:true,
    independentDomainApprovalsVerified:true,
    scopedLiveSnapshotVerified:true,
  });
  if(!plan)throw Error("f2_governed_plan_invalid");
  const nativeChangedRows=plan.rows.filter(row=>
    row.operation==="EFFECTIVE_DATED_NEW_VERSION").length;
  const masterChangedRows=plan.changedRows-nativeChangedRows;
  if(plan.changedRows===0)
    throw Error("f2_governed_no_changes_to_apply");
  // This is the *source-owned* policy permission, not a submitted flag.
  // Caller must not expose this constructor in an HTTP body or route.
  const authority:F2EffectiveApplyAuthority={
    organizationId:source.organizationId,branchId:source.branchId,
    batchId:source.batchId,actorUserId:source.actorUserId,
    clinicalSignerId:verified.clinical.signerUserId,
    financialSignerId:verified.financial.signerUserId,
    journalSigningSecret:secret,
    sourceInstallationVerified:true,qualifiedDomainSignersVerified:true,
    currentPermissionsAndBranchScopeVerified:true,
    signedStageAndLiveSnapshotVerified:true,
  };
  // Both families must run in the EXACT SAME Prisma transaction under
  // the organization's FOR UPDATE lock. Neither helper owns commit/rollback.
  // A failure in either family MUST roll back all SQL writes and audit events.
  const mixed=masterChangedRows>0&&nativeChangedRows>0;
  if(mode==="APPLY"){
    const native=nativeChangedRows?await applyF2EffectiveVersionsUnderLock(
      tx,plan,authority,now,mixed):null;
    const masters=masterChangedRows?await recordF2CatalogMasterRevisionsUnderLock(
      tx,plan,authority,now,mixed):null;
    if(!masters && native)return native;
    return {state:"TEN_CLASS_CONFIGURATION_SCHEDULED" as const,
      nativeChangedRows,masterChangedRows,
      nativeVersionIds:native?.createdVersionIds??[],
      masterRevisionIds:masters?.revisionIds??[]};
  }
  const masters=masterChangedRows?await cancelF2FutureMasterRevisionsUnderLock(
    tx,plan,authority,now,mixed):null;
  const native=nativeChangedRows?await reverseF2FutureEffectiveVersionsUnderLock(
    tx,plan,authority,now,mixed):null;
  if(!masters && native)return native;
  return {state:"TEN_CLASS_CONFIGURATION_REVERSED" as const,
    nativeChangedRows,masterChangedRows,
    nativeVersionIds:[],masterRevisionIds:[]};
}
