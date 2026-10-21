import type {Prisma} from "../../generated/prisma/client";
import type {getCurrentSession} from "./auth.ts";
import {resolveClinicalImportScope} from "./catalog-clinical-import-scope.ts";
import {catalogBundleSigningSecret} from "./catalog-bundle-attestation.ts";
import {reviewStageBatchMetadata} from "./catalog-review-stage-evidence.ts";
import {validatePolicyReviewBatchScope} from "./catalog-policy-review-scope.ts";
import {catalogExportTypes,type CatalogExportType} from "./catalog-configuration-export.ts";
import {readCatalogLiveObservations} from "./catalog-live-observation.ts";
import {loadF2VerifiedSourceReceiptUnderLock} from "./catalog-f2-source-receipt.ts";
import {executeF2GovernedApplicationUnderLock}
  from "./catalog-f2-governed-application.ts";
import {verifyBranchScopedPolicyDraftHistory,
  POLICY_DRAFT_HISTORY_LIMIT} from "./catalog-policy-draft-history.ts";
import {verifyCatalogApprovalHistory,
  type CatalogApprovalContext} from "./catalog-f2-approval-evidence.ts";
import {catalogDriftObservationToken} from "./catalog-drift-triage.ts";
import {createHash} from "node:crypto";

type Session=NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
type Failure={ok:false;code:string};
type Success={ok:true;result:{
  state:string;changedRows:number;effectiveAt:string;
  masterWritesScheduled:true;
}};
const fail=(code:string):Failure=>({ok:false,code});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const obj=(v:unknown):v is Record<string,unknown> =>
  v!==null&&typeof v==="object"&&!Array.isArray(v);
const ALL=["catalog.manage","catalog.reference_ranges.manage",
  "pricing.manage","catalog.configuration.apply"] as const;
const grants=(roles:readonly {role:{status:string;organizationId:string;
  permissions:readonly {permission:{code:string}}[]}}[],org:string)=>
  new Set(roles.filter(x=>x.role.status==="ACTIVE"&&x.role.organizationId===org)
    .flatMap(x=>x.role.permissions.map(y=>y.permission.code)));

/**
 * FOR UPDATE is owned by the caller. This component must NEVER be called
 * with a client-supplied source/mapping/signatory "verified" boolean.
 * Derive all capabilities from the current tenant's authoritative DB
 * records while holding the same row lock as the application writes.
 */
export async function applyF2ConfigurationFromVerifiedDatabaseUnderLock(
  tx:Prisma.TransactionClient,session:Session,batchId:string,now:Date,
):Promise<Failure|Success>{
  const org=session.user.organizationId,actor=session.user.id;
  if(!UUID.test(batchId)||!Number.isFinite(now.getTime()))
    return fail("f2_apply_invalid_context");
  const currentUser=await tx.user.findFirst({
    where:{id:actor,organizationId:org,status:"ACTIVE"},
    select:{roles:{include:{role:{include:{
      permissions:{include:{permission:true}},
    }}}}},
  });
  if(!currentUser||!ALL.every(x=>grants(currentUser.roles,org).has(x)))
    return fail("f2_apply_permission_revoked");
  const branch=await tx.branch.findFirst({
    where:{id:session.activeBranchId||"",organizationId:org,status:"ACTIVE"},
    select:{id:true,organizationId:true,status:true},
  });
  const currentBranches=await tx.userBranchScope.findMany({
    where:{userId:actor,branch:{organizationId:org,status:"ACTIVE"}},
    select:{branchId:true},
  });
  const originalBranches=new Set(session.user.branchScopes.filter(b=>
    b.branch.organizationId===org&&b.branch.status==="ACTIVE"
  ).map(b=>b.branchId));
  const grantedBranchIds=currentBranches.map(x=>x.branchId)
    .filter(x=>originalBranches.has(x));
  const currentDepartments=await tx.userDepartmentScope.findMany({
    where:{userId:actor},
    select:{departmentId:true,
      department:{select:{organizationId:true,branchId:true,status:true}}},
  });
  const originalDepartments=new Set(session.user.departmentScopes.map(x=>x.departmentId));
  const previouslyRestricted=session.user.departmentScopes.length>0;
  const departments=previouslyRestricted?
    currentDepartments.filter(x=>originalDepartments.has(x.departmentId)):
    currentDepartments;
  if(previouslyRestricted&&!departments.length)
    return fail("f2_apply_department_scope_revoked");
  const scope=resolveClinicalImportScope({
    organizationId:org,activeBranchId:session.activeBranchId,activeBranch:branch,
    branchScopes:grantedBranchIds.map(branchId=>({
      branchId,branch:{status:"ACTIVE"},
    })),
    departmentScopes:departments,
  });
  if(!scope)return fail("f2_apply_branch_scope_revoked");
  const batch=await tx.catalogImportBatch.findFirst({
    where:{id:batchId,organizationId:org,
      sourceType:"CONFIG_BUNDLE_REVIEW",status:"DRAFT"},
    select:{id:true,sourceType:true,sourceName:true,status:true,
      sourceChecksum:true,summary:true,createdByUserId:true},
  });
  if(!batch?.sourceChecksum||actor===batch.createdByUserId)
    return fail("f2_apply_no_independent_draft");
  const secret=catalogBundleSigningSecret(process.env);
  const summary=obj(batch.summary)?batch.summary:null;
  const seal=summary&&obj(summary.stageEvidenceSeal)?summary.stageEvidenceSeal:null;
  if(!secret||!seal||typeof seal.signature!=="string"||
     !SHA.test(seal.signature))
    return fail("f2_apply_stage_signing_unavailable");
  const batchScope=await validatePolicyReviewBatchScope(tx,{
    batchId,scope,grantedBranchIds,sourceChecksum:batch.sourceChecksum,
    authorUserId:batch.createdByUserId,
    stageEvidenceSeal:seal,batchMetadata:reviewStageBatchMetadata(batch),
    signingSecret:secret,allowGovernedValueDifferences:true,
  });
  if(!batchScope.ok)return fail("f2_apply_source_or_scope_invalid");
  const all=await tx.catalogImportRow.findMany({
    where:{batchId},orderBy:{rowNumber:"asc"},take:5001,
    select:{rowNumber:true,entityType:true,sourceData:true,normalizedData:true},
  });
  if(all.length<10||all.length>5000||
     new Set(all.map(x=>x.entityType)).size!==catalogExportTypes.size ||
     [...catalogExportTypes].some(x=>!all.some(r=>r.entityType===x)))
    return fail("f2_apply_ten_class_stage_required");
  const authorityKeyId=process.env.F2_SOURCE_AUTHORITY_KEY_ID;
  const publicKeyPem=process.env.F2_SOURCE_AUTHORITY_PUBLIC_KEY_PEM;
  const targetInstallationId=process.env.F2_TARGET_INSTALLATION_ID;
  const keyValidFrom=process.env.F2_SOURCE_AUTHORITY_VALID_FROM;
  const keyValidTo=process.env.F2_SOURCE_AUTHORITY_VALID_TO;
  if(!authorityKeyId||!publicKeyPem||!targetInstallationId||
     !keyValidFrom||!keyValidTo)
    return fail("f2_apply_source_authority_unconfigured");
  const sourceReceipt=await loadF2VerifiedSourceReceiptUnderLock(tx,{
    trusted:{authorityKeyId,publicKeyPem,targetInstallationId,
      keyValidFrom,keyValidTo,organizationId:org,batchId,
      sourceChecksum:batch.sourceChecksum},
    branchId:scope.branchId,sourceAuthorUserId:batch.createdByUserId,
    stagedRows:all,now,
  });
  if(!sourceReceipt)return fail("f2_apply_original_installation_not_verified");
  const byType=new Map<CatalogExportType,string[]>();
  for(const [index,row] of all.entries()){
    if(row.rowNumber!==index+1||
       !catalogExportTypes.has(row.entityType as CatalogExportType)||
       !obj(row.normalizedData)||typeof row.normalizedData.id!=="string"||
       !UUID.test(row.normalizedData.id))
      return fail("f2_apply_invalid_staging_identity");
    const type=row.entityType as CatalogExportType;
    byType.set(type,[...(byType.get(type)||[]),row.normalizedData.id]);
  }
  const live=await readCatalogLiveObservations(tx,scope,grantedBranchIds,byType);
  if(!live)return fail("f2_apply_live_scope_changed");
  const snapshot=createHash("sha256");
  const rows=all.map(row=>{
    const id=(row.normalizedData as {id:string}).id;
    const observation=live.get(row.entityType+":"+id);
    if(!observation)return null;
    const digest=catalogDriftObservationToken(secret,batch.sourceChecksum!,
      row.rowNumber,row.entityType,row.sourceData,observation);
    snapshot.update(JSON.stringify([row.rowNumber,row.entityType,digest]));
    return {...row,scopedLiveData:observation};
  });
  if(rows.some(row=>row===null))return fail("f2_apply_live_record_missing");
  const policyEvents=await tx.auditEvent.findMany({
    where:{organizationId:org,entityType:"CatalogImportBatch",entityId:batchId,
      action:"CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED"},
    orderBy:[{occurredAt:"desc"},{id:"desc"}],
    take:POLICY_DRAFT_HISTORY_LIMIT+1,
    select:{id:true,actorUserId:true,branchId:true,newValues:true},
  });
  const policy=verifyBranchScopedPolicyDraftHistory({
    events:policyEvents,organizationId:org,batchId,branchId:scope.branchId,
    sourceChecksum:batch.sourceChecksum,authorUserId:batch.createdByUserId,
  })?.draft;
  if(!policy||Object.values(policy.proposal).includes("UNDECIDED"))
    return fail("f2_apply_policy_incomplete");
  const approvalEvents=await tx.auditEvent.findMany({
    where:{organizationId:org,entityType:"CatalogImportBatch",entityId:batchId,
      action:"CATALOG_F2_CONFIGURATION_APPROVAL_SIGNED"},
    orderBy:[{occurredAt:"desc"},{id:"desc"}],take:3,
    select:{id:true,actorUserId:true,branchId:true,newValues:true},
  });
  const first=approvalEvents[0]?.newValues;
  if(!obj(first)||typeof first.effectiveAt!=="string")
    return fail("f2_apply_signed_approvals_missing");
  const approvalContext:CatalogApprovalContext={
    organizationId:org,batchId,branchId:scope.branchId,
    authorUserId:batch.createdByUserId,sourceChecksum:batch.sourceChecksum,
    stagedEvidenceDigest:seal.signature,
    policyDigest:policy.proposalDigest,liveSnapshotDigest:snapshot.digest("hex"),
    effectiveAt:first.effectiveAt,
  };
  const verified=verifyCatalogApprovalHistory({
    context:approvalContext,events:approvalEvents,secret,
  });
  if(!verified?.technicallyApproved||!verified.clinical||!verified.financial||
     actor===verified.clinical.signerUserId||
     actor===verified.financial.signerUserId)
    return fail("f2_apply_approval_invalid_or_stale");
  const signerIds=[verified.clinical.signerUserId,verified.financial.signerUserId];
  const signers=await tx.user.findMany({
    where:{id:{in:signerIds},organizationId:org,status:"ACTIVE"},
    select:{id:true,mfaEnabled:true,mfaConfirmedAt:true,
      roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}},
    },
  });
  const branchSigners=await tx.userBranchScope.findMany({
    where:{userId:{in:signerIds},branchId:scope.branchId,
      branch:{organizationId:org,status:"ACTIVE"}},
    select:{userId:true},
  });
  if(signers.length!==2||branchSigners.length!==2)
    return fail("f2_apply_signatory_scope_revoked");
  const required=(domain:"CLINICAL"|"FINANCIAL")=>domain==="CLINICAL"?
    ["catalog.manage","catalog.reference_ranges.manage",
      "catalog.configuration.clinical.sign"]:
    ["catalog.manage","pricing.manage",
      "catalog.configuration.financial.sign"];
  if(signers.some(s=>!s.mfaEnabled||!s.mfaConfirmedAt) ||
     !required("CLINICAL").every(p=>grants(signers.find(s=>
       s.id===verified.clinical!.signerUserId)?.roles||[],org).has(p)) ||
     !required("FINANCIAL").every(p=>grants(signers.find(s=>
       s.id===verified.financial!.signerUserId)?.roles||[],org).has(p)))
    return fail("f2_apply_signatory_grants_revoked");
  // Only code-derived booleans are passed to the execution core; never from
  // HTTP bodies or review-only HMAC diagnostics.
  const result=await executeF2GovernedApplicationUnderLock(tx,{
    source:{
      organizationId:org,branchId:scope.branchId,batchId,
      authorUserId:batch.createdByUserId,actorUserId:actor,
      sourceChecksum:batch.sourceChecksum,
      stageEvidenceDigest:seal.signature,
      policyDigest:policy.proposalDigest,effectiveAt:approvalContext.effectiveAt,
      sourceInstallationVerified:true,fullyScopedStageVerified:true,
      fullDomainSignatoryGrantsCurrentlyVerified:true,
      currentOperatorScopesVerified:true,
      independentlyVerifiedInstallationMapping:true,
    },rows:rows.filter((x):x is NonNullable<typeof x>=>x!==null),
    approvals:approvalEvents,secret,now,mode:"APPLY",
  });
  const changedRows="changedRows" in result ? result.changedRows :
    result.nativeChangedRows+result.masterChangedRows;
  return {ok:true,result:{
    state:result.state,changedRows,effectiveAt:approvalContext.effectiveAt,
    masterWritesScheduled:true,
  }};
}
