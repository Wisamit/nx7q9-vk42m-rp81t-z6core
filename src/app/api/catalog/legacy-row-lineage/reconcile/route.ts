import {NextRequest,NextResponse} from "next/server";
import {getCurrentSession,permissionSet,requestContext} from "@/lib/auth";
import {prisma} from "@/lib/db";
import {parseF3UnverifiedDigestManifest}
  from "@/lib/f3-legacy-manifest-validator";
import {reconcileF3LegacySource}
  from "@/lib/f3-legacy-source-reconciliation";
import {f3LiveLineageTargetsVisible}
  from "@/lib/f3-legacy-target-visibility";

export const dynamic="force-dynamic";
const LIMIT=8*1024*1024;
const PERMISSIONS=["catalog.manage","pricing.manage",
  "catalog.reference_ranges.manage"] as const;
const headers={"Cache-Control":"private, no-store",
  "X-Content-Type-Options":"nosniff"};
const fail=(error:string,status:number)=>
  NextResponse.json({error},{status,headers});

/**
 * Compare an OFFLINE, HMAC-ONLY 15-table Access fingerprint against the
 * organization's actual persisted row-lineage classifications.
 *
 * The entire 15-table scope demands organization-wide branch grants,
 * no department restriction and both medical+financial review permissions.
 * Recheck all grants inside a tenant-locked DB transaction. This endpoint
 * never accepts raw MDB data and never approves or activates any master.
 */
export async function POST(request:NextRequest){
  const session=await getCurrentSession();
  if(!session)return fail("unauthorized",401);
  const org=session.user.organizationId;
  const original=permissionSet(session);
  const branchId=session.activeBranchId;
  if(!PERMISSIONS.every(p=>original.has(p))||
     !branchId||session.user.departmentScopes.length!==0||
     !session.user.branchScopes.some(grant=>
       grant.branchId===branchId&&grant.branch.organizationId===org&&
       grant.branch.status==="ACTIVE"))
    return fail("f3_organization_scope_required",403);
  if([...request.nextUrl.searchParams.keys()].length||
     (request.headers.get("sec-fetch-site")==="cross-site"))
    return fail("f3_cross_site_or_query_denied",403);
  const origin=request.headers.get("origin");
  if(origin&&origin!==request.nextUrl.origin)
    return fail("f3_cross_origin_denied",403);
  if((request.headers.get("content-type")||"")
      .split(";")[0].trim().toLowerCase()!=="application/json")
    return fail("f3_digest_json_required",415);
  const stated=Number(request.headers.get("content-length")||"0");
  if(!Number.isSafeInteger(stated)||stated<0||stated>LIMIT)
    return fail("f3_digest_payload_too_large",413);
  const reader=request.body?.getReader();
  if(!reader)return fail("f3_digest_body_missing",400);
  const parts:Uint8Array[]=[];let total=0;
  for(;;){
    const item=await reader.read();
    if(item.done)break;
    total+=item.value.byteLength;
    if(total>LIMIT){
      await reader.cancel("f3_digest_payload_too_large");
      return fail("f3_digest_payload_too_large",413);
    }
    parts.push(item.value);
  }
  let manifest:ReturnType<typeof parseF3UnverifiedDigestManifest>;
  try{
    const json=JSON.parse(new TextDecoder("utf-8",{fatal:true})
      .decode(Buffer.concat(parts)));
    manifest=parseF3UnverifiedDigestManifest(json,org);
  }catch{return fail("f3_digest_invalid_manifest",400);}
  const ctx=await requestContext();
  const outcome=await prisma.$transaction(async tx=>{
    const locks=await tx.$queryRaw<Array<{id:string}>>`
      SELECT id FROM organizations WHERE id=${org} AND status='ACTIVE' FOR UPDATE`;
    if(locks.length!==1)return {error:"f3_organization_inactive",
      code:403} as const;
    const [actor,branches,grants,departments,activeBranch]=await Promise.all([
      tx.user.findFirst({where:{id:session.user.id,organizationId:org,
        status:"ACTIVE"},select:{id:true,roles:{select:{role:{select:{
        organizationId:true,status:true,permissions:{select:{
          permission:{select:{code:true}}}},
      }}}}}}),
      tx.branch.findMany({where:{organizationId:org,status:"ACTIVE"},
        select:{id:true}}),
      tx.userBranchScope.findMany({where:{userId:session.user.id,
        branch:{organizationId:org,status:"ACTIVE"}},
        select:{branchId:true}}),
      tx.userDepartmentScope.count({where:{userId:session.user.id}}),
      tx.branch.findFirst({where:{id:branchId,organizationId:org,
        status:"ACTIVE"},select:{id:true}}),
    ]);
    const live=new Set(actor?.roles.filter(r=>
      r.role.status==="ACTIVE"&&r.role.organizationId===org)
      .flatMap(r=>r.role.permissions.map(p=>p.permission.code))||[]);
    const originalBranches=new Set(session.user.branchScopes.filter(g=>
      g.branch.organizationId===org&&g.branch.status==="ACTIVE")
      .map(g=>g.branchId));
    const scoped=new Set(grants.map(g=>g.branchId));
    if(!PERMISSIONS.every(p=>live.has(p))||!activeBranch||
       departments!==0||branches.length<1||
       originalBranches.size!==branches.length||
       scoped.size!==branches.length||
       branches.some(b=>!originalBranches.has(b.id)||!scoped.has(b.id)))
      return {error:"f3_organization_permissions_revoked",
        code:403} as const;
    const rows=await tx.legacyCatalogRowLineage.findMany({
      where:{organizationId:org,sourceSha256:manifest.sourceSha256,
        digestKeyId:manifest.digestKeyId},
      select:{organizationId:true,sourceSha256:true,digestKeyId:true,
        sourceTable:true,sourceSchemaSha256:true,rowDigest:true,
        occurrence:true,classification:true,targetType:true,targetId:true},
      take:20001,
    });
    if(rows.length>20000)return {
      error:"f3_legacy_lineage_too_large",code:409,
    } as const;
    const visible=await f3LiveLineageTargetsVisible(tx,{
      organizationId:org,lineage:rows,
      currentOrganizationScopeVerified:true,
    });
    if(!visible)return {
      error:"f3_lineage_target_scope_changed",code:409,
    } as const;
    let report:ReturnType<typeof reconcileF3LegacySource>;
    try{
      report=reconcileF3LegacySource({
        manifest,lineage:rows,tenantAndTargetScopeVerified:true,
      });
    }catch(error){
      if(error instanceof Error&&error.message.startsWith("f3_"))
        return {error:"f3_lineage_source_mismatch",code:409} as const;
      throw error;
    }
    await tx.auditEvent.create({data:{
      organizationId:org,branchId,actorUserId:session.user.id,
      action:"F3_LEGACY_DIGEST_RECONCILIATION_REVIEWED",
      entityType:"LegacyCatalogRowLineage",entityId:manifest.sourceSha256,
      newValues:{
        tableCount:manifest.tableCount,sourceRows:report.sourceRows,
        recordedRows:report.matchedRows,missingRows:report.missingRows,
        ambiguousRows:report.dispositions.AMBIGUOUS,
        manyToOneTargets:report.manyToOneTargets,
        codeOnly:true,sourceOriginalProven:false,
        mappingApproved:false,liveWrites:false,
      },
      ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    }});
    return {ok:true,report} as const;
  },{isolationLevel:"RepeatableRead",timeout:30000});
  if("error" in outcome&&typeof outcome.error==="string" &&
     "code" in outcome&&typeof outcome.code==="number")
    return fail(outcome.error,outcome.code);
  if("report" in outcome)
    return NextResponse.json(outcome.report,{headers});
  return fail("f3_unexpected_reconciliation_state",409);
}
