import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { decryptSecret, verifyTotp } from "@/lib/staff-mfa";
import { resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { BUNDLE_REVIEW_SOURCE, BUNDLE_REVIEW_MAX_ROWS } from "@/lib/catalog-bundle-review";
import { reviewStageBatchMetadata } from "@/lib/catalog-review-stage-evidence";
import { validatePolicyReviewBatchScope } from "@/lib/catalog-policy-review-scope";
import { catalogBundleSigningSecret } from "@/lib/catalog-bundle-attestation";
import { catalogExportTypes, type CatalogExportType } from "@/lib/catalog-configuration-export";
import { catalogDriftObservationToken } from "@/lib/catalog-drift-triage";
import { readF2EffectiveLiveObservations } from "@/lib/catalog-f2-effective-live-observation";
import { f2GovernedReadinessPreview } from "@/lib/catalog-f2-governed-readiness";
import { verifyBranchScopedPolicyDraftHistory, POLICY_DRAFT_HISTORY_LIMIT } from "@/lib/catalog-policy-draft-history";
import { domainReviewPermissions } from "@/lib/catalog-policy-draft-review";
import {
  createCatalogApprovalEvidence, verifyCatalogApprovalHistory,
  type CatalogApprovalContext, type CatalogApprovalDomain,
} from "@/lib/catalog-f2-approval-evidence";

export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const headers={"Cache-Control":"private, no-store"};
const reject=(error:string,status:number)=>
  NextResponse.json({error},{status,headers});
const object=(value:unknown):value is Record<string,unknown> =>
  !!value && typeof value==="object" && !Array.isArray(value);
type Input={
  domain:CatalogApprovalDomain;decision:"APPROVE"|"REJECT";
  effectiveAt:string;expectedRevision:0|1;mfaCode:string;
};

/**
 * Record genuine HMAC-authenticated, recently reauthenticated technical
 * signoff evidence. This endpoint NEVER applies catalog configuration.
 * Qualification, original source provenance and live activation require
 * separate explicitly authorized policies and executable guarded workflow.
 */
export async function POST(request:NextRequest,{params}:{
  params:Promise<{id:string}>;
}){
  if([...request.nextUrl.searchParams.keys()].length)
    return reject("configuration_approval_invalid_query",400);
  if((request.headers.get("content-type")||"").split(";")[0].trim().toLowerCase()!=="application/json")
    return reject("configuration_approval_json_required",415);
  if(request.headers.get("sec-fetch-site")==="cross-site")return reject("configuration_approval_cross_site",403);
  const origin=request.headers.get("origin");
  if(origin && origin!==new URL(request.url).origin)
    return reject("configuration_approval_origin",403);
  const declared=Number(request.headers.get("content-length")||0);
  if(!Number.isSafeInteger(declared)||declared<0||declared>640)
    return reject("configuration_approval_too_large",413);
  const reader=request.body?.getReader();
  if(!reader)return reject("configuration_approval_body_required",400);
  const parts:Uint8Array[]=[];let bytes=0;
  for(;;){
    const part=await reader.read();if(part.done)break;
    bytes+=part.value.byteLength;
    if(bytes>640){await reader.cancel("too_large");return reject("configuration_approval_too_large",413);}
    parts.push(part.value);
  }
  let value:unknown;
  try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(parts)));}
  catch{return reject("configuration_approval_invalid_json",400);}
  if(!object(value)||Object.keys(value).sort().join(",")!==
      "decision,domain,effectiveAt,expectedRevision,mfaCode" ||
     (value.domain!=="CLINICAL"&&value.domain!=="FINANCIAL") ||
     (value.decision!=="APPROVE"&&value.decision!=="REJECT") ||
     (value.expectedRevision!==0&&value.expectedRevision!==1) ||
     typeof value.mfaCode!=="string"||!/^[0-9]{6}$/.test(value.mfaCode) ||
     typeof value.effectiveAt!=="string"||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.effectiveAt)||
     !Number.isFinite(Date.parse(value.effectiveAt)))
    return reject("configuration_approval_invalid_request",400);
  const input=value as Input;
  const session=await getCurrentSession();
  if(!session)return reject("unauthorized",401);
  const own=permissionSet(session);
  const requiredSign=input.domain==="CLINICAL"?
    "catalog.configuration.clinical.sign":"catalog.configuration.financial.sign";
  if(!own.has(requiredSign) ||
     !domainReviewPermissions(input.domain,own) ||
     !session.user.mfaEnabled || !session.user.mfaConfirmedAt)
    return reject("configuration_approval_signer_not_qualified",403);
  const {id:batchId}=await params;
  if(!UUID.test(batchId))return reject("configuration_approval_batch_not_found",404);
  const org=session.user.organizationId;
  const secret=catalogBundleSigningSecret(process.env);
  if(!secret)return reject("configuration_approval_key_unavailable",503);
  const ctx=await requestContext();
  const outcome=await prisma.$transaction(async tx=>{
    const locked=await tx.$queryRaw<Array<{id:string}>>`
      SELECT id FROM organizations WHERE id=${org} AND status='ACTIVE' FOR UPDATE`;
    if(locked.length!==1)return {error:"configuration_approval_organization_inactive",httpStatus:403} as const;
    const currentUser=await tx.user.findFirst({
      where:{id:session.user.id,organizationId:org,status:"ACTIVE"},
      select:{mfaEnabled:true,mfaConfirmedAt:true,mfaSecretEncrypted:true,
        roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}},
    });
    const current=new Set(currentUser?.roles.filter(role=>
      role.role.status==="ACTIVE"&&role.role.organizationId===org,
    ).flatMap(role=>role.role.permissions.map(permission=>permission.permission.code))||[]);
    if(!current.has(requiredSign)||!domainReviewPermissions(input.domain,current)||
       !currentUser?.mfaEnabled||!currentUser.mfaConfirmedAt||
       !currentUser.mfaSecretEncrypted)
      return {error:"configuration_approval_signer_revoked",httpStatus:403} as const;
    const branch=await tx.branch.findFirst({
      where:{id:session.activeBranchId||"",organizationId:org,status:"ACTIVE"},
      select:{id:true,organizationId:true,status:true},
    });
    const grants=await tx.userBranchScope.findMany({
      where:{userId:session.user.id,branch:{organizationId:org,status:"ACTIVE"}},
      select:{branchId:true},
    });
    const originalBranches=new Set(session.user.branchScopes.filter(x=>
      x.branch.organizationId===org && x.branch.status==="ACTIVE").map(x=>x.branchId));
    const grantedBranchIds=grants.map(x=>x.branchId).filter(id=>originalBranches.has(id));
    const departmentGrants=await tx.userDepartmentScope.findMany({
      where:{userId:session.user.id},
      select:{departmentId:true,department:{select:{organizationId:true,branchId:true,status:true}}},
    });
    const originallyRestricted=session.user.departmentScopes.length>0;
    const originalDepartments=new Set(session.user.departmentScopes.map(x=>x.departmentId));
    const departments=originallyRestricted ?
      departmentGrants.filter(x=>originalDepartments.has(x.departmentId)) :
      departmentGrants;
    if(originallyRestricted&&!departments.length)
      return {error:"configuration_approval_department_revoked",httpStatus:403} as const;
    const scope=resolveClinicalImportScope({
      organizationId:org,activeBranchId:session.activeBranchId,
      activeBranch:branch,
      branchScopes:grantedBranchIds.map(branchId=>({branchId,branch:{status:"ACTIVE"}})),
      departmentScopes:departments,
    });
    if(!scope)return {error:"configuration_approval_branch_revoked",httpStatus:403} as const;
    const batch=await tx.catalogImportBatch.findFirst({
      where:{id:batchId,organizationId:org,sourceType:BUNDLE_REVIEW_SOURCE,status:"DRAFT"},
      select:{id:true,sourceType:true,sourceName:true,status:true,sourceChecksum:true,
        createdByUserId:true,summary:true},
    });
    if(!batch?.sourceChecksum)
      return {error:"configuration_approval_batch_not_found",httpStatus:404} as const;
    if(batch.createdByUserId===session.user.id)
      return {error:"configuration_approval_independent_signer_required",httpStatus:403} as const;
    const metadata=reviewStageBatchMetadata(batch);
    const seal=object(batch.summary)?batch.summary.stageEvidenceSeal:null;
    if(!object(seal)||!SHA.test(String(seal.signature||"")))
      return {error:"configuration_approval_stage_seal_missing",httpStatus:409} as const;
    const verified=await validatePolicyReviewBatchScope(tx,{
      batchId:batch.id,scope,grantedBranchIds,sourceChecksum:batch.sourceChecksum,
      authorUserId:batch.createdByUserId,stageEvidenceSeal:seal,
      batchMetadata:metadata,signingSecret:secret,
      // Intentional clinical and tariff changes are separately protected by
      // signed source/live observations and two-domain MFA approvals.
      allowGovernedValueDifferences:true,
    });
    if(!verified.ok)return {error:verified.error,httpStatus:409} as const;
    const rows=await tx.catalogImportRow.findMany({
      where:{batchId:batch.id},orderBy:{rowNumber:"asc"},
      select:{rowNumber:true,entityType:true,sourceData:true,normalizedData:true},
    });
    if(!rows.length||rows.length>BUNDLE_REVIEW_MAX_ROWS)
      return {error:"configuration_approval_invalid_stage",httpStatus:409} as const;
    const byType=new Map<CatalogExportType,string[]>();
    for(const [i,row] of rows.entries()){
      if(row.rowNumber!==i+1 ||
         !catalogExportTypes.has(row.entityType as CatalogExportType) ||
         !object(row.normalizedData) || typeof row.normalizedData.id!=="string" ||
         !UUID.test(row.normalizedData.id))
        return {error:"configuration_approval_invalid_stage_row",httpStatus:409} as const;
      const type=row.entityType as CatalogExportType;
      byType.set(type,[...(byType.get(type)||[]),row.normalizedData.id]);
    }
    const live=await readF2EffectiveLiveObservations(tx,scope,grantedBranchIds,byType,new Date());
    if(!live)return {error:"configuration_approval_live_scope_changed",httpStatus:409} as const;
    const snapshot=createHash("sha256");
    for(const row of rows){
      const id=(row.normalizedData as {id:string}).id;
      const observation=live.get(row.entityType+":"+id);
      if(!observation || !f2GovernedReadinessPreview({
        entityType:row.entityType,sourceData:row.sourceData,
        scopedLiveData:observation,signedStageVerified:true,
        liveFieldObservationRevalidated:true,
      }))return {error:"configuration_approval_live_projection_changed",httpStatus:409} as const;
      const token=catalogDriftObservationToken(secret,batch.sourceChecksum,
        row.rowNumber,row.entityType,row.sourceData,observation);
      snapshot.update(JSON.stringify([row.rowNumber,row.entityType,token]));
    }
    const drafts=await tx.auditEvent.findMany({
      where:{organizationId:org,entityType:"CatalogImportBatch",entityId:batch.id,
        action:"CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED"},
      orderBy:[{occurredAt:"desc"},{id:"desc"}],take:POLICY_DRAFT_HISTORY_LIMIT+1,
      select:{id:true,actorUserId:true,branchId:true,newValues:true},
    });
    const draft=verifyBranchScopedPolicyDraftHistory({
      events:drafts,authorUserId:batch.createdByUserId,
      organizationId:org,batchId:batch.id,branchId:scope.branchId,
      sourceChecksum:batch.sourceChecksum,
    })?.draft;
    if(!draft||Object.values(draft.proposal).includes("UNDECIDED"))
      return {error:"configuration_approval_policy_incomplete",httpStatus:409} as const;
    const approvalContext:CatalogApprovalContext={
      organizationId:org,batchId:batch.id,branchId:scope.branchId,
      authorUserId:batch.createdByUserId,sourceChecksum:batch.sourceChecksum,
      stagedEvidenceDigest:String(seal.signature),
      liveSnapshotDigest:snapshot.digest("hex"),
      policyDigest:draft.proposalDigest,effectiveAt:input.effectiveAt,
    };
    const events=await tx.auditEvent.findMany({
      where:{organizationId:org,action:"CATALOG_F2_CONFIGURATION_APPROVAL_SIGNED",
        entityType:"CatalogImportBatch",entityId:batch.id},
      orderBy:[{occurredAt:"desc"},{id:"desc"}],take:3,
      select:{id:true,actorUserId:true,branchId:true,newValues:true},
    });
    const history=verifyCatalogApprovalHistory({
      context:approvalContext,events,secret,
    });
    if(!history)return {error:"configuration_approval_history_invalid",httpStatus:409} as const;
    if(input.expectedRevision!==history.revision)
      return {error:"configuration_approval_revision_conflict",httpStatus:409} as const;
    if(history.revision>=2)
      return {error:"configuration_approval_already_decided",httpStatus:409} as const;
    const previous=history.clinical||history.financial;
    if(previous && (previous.domain===input.domain ||
       previous.signerUserId===session.user.id ||
       previous.decision==="REJECT"))
      return {error:"configuration_approval_distinct_domain_required",httpStatus:403} as const;
    const now=new Date();
    let mfaOk=false;
    try { mfaOk=verifyTotp(decryptSecret(currentUser.mfaSecretEncrypted),
      input.mfaCode,now.getTime()); }catch{return {error:"configuration_approval_mfa_unavailable",httpStatus:403} as const;}
    if(!mfaOk)return {error:"configuration_approval_mfa_invalid",httpStatus:403} as const;
    const evidence=createCatalogApprovalEvidence(approvalContext,{
      revision:(history.revision+1) as 1|2,
      previousDigest:previous?.digest??null,domain:input.domain,
      signerUserId:session.user.id,decision:input.decision,
      mfaVerifiedAt:now.toISOString(),signedAt:now.toISOString(),
    },secret);
    await tx.auditEvent.create({data:{
      organizationId:org,branchId:scope.branchId,actorUserId:session.user.id,
      action:"CATALOG_F2_CONFIGURATION_APPROVAL_SIGNED",
      entityType:"CatalogImportBatch",entityId:batch.id,newValues:evidence,
      ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    }});
    // An HMAC-valid technical decision never bypasses installation lineage,
    // professional qualification, live target drift or guarded atomic apply.
    return {status:"CONFIGURATION_APPROVAL_EVIDENCE_RECORDED",
      approvalRevision:evidence.revision,domain:evidence.domain,
      technicallyApproved:history.revision===1 && input.decision==="APPROVE" &&
        previous?.decision==="APPROVE",
      sourceInstallationVerified:false,qualifiedHumanApprovalVerified:false,
      liveApplyAuthorized:false,liveWrites:false} as const;
  },{isolationLevel:"RepeatableRead",timeout:30000});
  if("error" in outcome && typeof outcome.error==="string" &&
     "httpStatus" in outcome && typeof outcome.httpStatus==="number")
    return reject(outcome.error,outcome.httpStatus);
  return NextResponse.json(outcome,{headers});
}
