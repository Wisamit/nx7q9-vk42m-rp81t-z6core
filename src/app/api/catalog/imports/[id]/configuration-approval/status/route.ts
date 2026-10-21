import {NextRequest,NextResponse} from "next/server";
import {getCurrentSession,permissionSet} from "@/lib/auth";
import {prisma} from "@/lib/db";
import {catalogBundleSigningSecret} from "@/lib/catalog-bundle-attestation";
import {BUNDLE_REVIEW_SOURCE} from "@/lib/catalog-bundle-review";
import {domainReviewPermissions} from "@/lib/catalog-policy-draft-review";
import {verifyCatalogApprovalHistory,
  type CatalogApprovalContext} from "@/lib/catalog-f2-approval-evidence";

export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const headers={"Cache-Control":"private, no-store"};
const deny=(code:string,status:number)=>NextResponse.json({error:code},{status,headers});
const obj=(v:unknown):v is Record<string,unknown>=>
  v!==null&&typeof v==="object"&&!Array.isArray(v);
const mayInspect=(grants:ReadonlySet<string>)=>grants.has("catalog.manage")&&
  (grants.has("catalog.configuration.clinical.sign")&&
   domainReviewPermissions("CLINICAL",grants)||
   grants.has("catalog.configuration.financial.sign")&&
   domainReviewPermissions("FINANCIAL",grants));

/**
 * Metadata-only, author-independent signature status. This GET never returns
 * reviewer IDs, MACs, confidential source values or a deployment authority.
 * The status describes historic signed evidence, not current source/live
 * parity; POST must always repeat the full ten-class preflight.
 */
export async function GET(request:NextRequest,{params}:{
  params:Promise<{id:string}>;
}){
  if([...request.nextUrl.searchParams.keys()].length)
    return deny("f2_sign_status_invalid_query",400);
  const session=await getCurrentSession();
  if(!session)return deny("unauthorized",401);
  const original=permissionSet(session);
  if(!mayInspect(original))return deny("f2_sign_status_permission_required",403);
  const {id:batchId}=await params;
  if(!UUID.test(batchId))return deny("f2_sign_status_not_found",404);
  const org=session.user.organizationId;
  const secret=catalogBundleSigningSecret(process.env);
  if(!secret)return deny("f2_sign_status_key_unavailable",503);
  const result=await prisma.$transaction(async tx=>{
    const locked=await tx.$queryRaw<Array<{id:string}>>`
      SELECT id FROM organizations WHERE id=${org} AND status='ACTIVE' FOR UPDATE`;
    if(locked.length!==1)return {error:"f2_sign_status_organization_inactive",status:403} as const;
    const [user,branchGrant,batch]=await Promise.all([
      tx.user.findFirst({
        where:{id:session.user.id,organizationId:org,status:"ACTIVE"},
        select:{roles:{include:{role:{include:{permissions:{include:{permission:true}}}}}}},
      }),
      tx.userBranchScope.findFirst({
        where:{userId:session.user.id,branchId:session.activeBranchId||"",
          branch:{organizationId:org,status:"ACTIVE"}},
        select:{branchId:true},
      }),
      tx.catalogImportBatch.findFirst({
        where:{id:batchId,organizationId:org,sourceType:BUNDLE_REVIEW_SOURCE,
          status:"DRAFT"},
        select:{id:true,sourceChecksum:true,createdByUserId:true,summary:true},
      }),
    ]);
    const live=new Set(user?.roles.filter(x=>x.role.status==="ACTIVE"&&
      x.role.organizationId===org).flatMap(x=>
      x.role.permissions.map(g=>g.permission.code))||[]);
    const originalBranches=new Set(session.user.branchScopes
      .filter(x=>x.branch.organizationId===org&&x.branch.status==="ACTIVE")
      .map(x=>x.branchId));
    if(!mayInspect(live)||!branchGrant||
      !originalBranches.has(branchGrant.branchId))
      return {error:"f2_sign_status_permission_revoked",status:403} as const;
    if(!batch||!batch.sourceChecksum || session.user.id===batch.createdByUserId)
      return {error:"f2_sign_status_not_found",status:404} as const;
    const summaries=obj(batch.summary)?batch.summary:null;
    const seal=summaries && obj(summaries.stageEvidenceSeal)?
      summaries.stageEvidenceSeal:null;
    if(!seal||typeof seal.signature!=="string"||!SHA.test(seal.signature) ||
      summaries?.attestationStatus!=="VERIFIED"||
      summaries?.fieldContractStatus!=="COMPLETE_SOURCE_FIELD_PROJECTION"||
      summaries?.consistency!=="transactional-consistent-read")
      return {error:"f2_sign_status_stage_not_verified",status:409} as const;
    const events=await tx.auditEvent.findMany({
      where:{organizationId:org,entityType:"CatalogImportBatch",
        entityId:batch.id,action:"CATALOG_F2_CONFIGURATION_APPROVAL_SIGNED"},
      orderBy:[{occurredAt:"desc"},{id:"desc"}],take:3,
      select:{id:true,actorUserId:true,branchId:true,newValues:true},
    });
    if(!events.length){
      return {status:"NOT_SIGNED",revision:0,effectiveAt:null,
        clinicalDecision:null,financialDecision:null,
        technicallyApproved:false,operationalReleaseApproved:false,
        readOnly:true,liveWrites:false} as const;
    }
    const raw=events[0].newValues;
    if(!obj(raw)||raw.organizationId!==org||
       raw.batchId!==batch.id ||
       raw.branchId!==branchGrant.branchId||
       raw.authorUserId!==batch.createdByUserId ||
       raw.sourceChecksum!==batch.sourceChecksum ||
       raw.stagedEvidenceDigest!==seal.signature ||
       typeof raw.liveSnapshotDigest!=="string"||
       typeof raw.policyDigest!=="string"||
       typeof raw.effectiveAt!=="string")
      return {error:"f2_sign_status_evidence_corrupt",status:409} as const;
    const context:CatalogApprovalContext={
      organizationId:org,batchId:batch.id,
      branchId:branchGrant.branchId,authorUserId:batch.createdByUserId,
      sourceChecksum:batch.sourceChecksum,
      stagedEvidenceDigest:seal.signature,
      liveSnapshotDigest:raw.liveSnapshotDigest,
      policyDigest:raw.policyDigest,effectiveAt:raw.effectiveAt,
    };
    const checked=verifyCatalogApprovalHistory({
      context,events,secret,
    });
    if(!checked)return {error:"f2_sign_status_evidence_corrupt",status:409} as const;
    return {status:checked.technicallyApproved?"TWO_DOMAINS_SIGNED":"PARTIALLY_SIGNED",
      revision:checked.revision,effectiveAt:context.effectiveAt,
      clinicalDecision:checked.clinical?.decision??null,
      financialDecision:checked.financial?.decision??null,
      technicallyApproved:checked.technicallyApproved,
      operationalReleaseApproved:false,readOnly:true,liveWrites:false,
    } as const;
  },{isolationLevel:"RepeatableRead",timeout:30000});
  if("error" in result && typeof result.error==="string"&&
    "status" in result&&typeof result.status==="number")
    return deny(result.error,result.status);
  return NextResponse.json(result,{headers});
}
