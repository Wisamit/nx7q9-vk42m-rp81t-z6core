import {NextRequest,NextResponse} from "next/server";
import {getCurrentSession,permissionSet} from "@/lib/auth";
import {prisma} from "@/lib/db";
import {applyF2ConfigurationFromVerifiedDatabaseUnderLock}
  from "@/lib/catalog-f2-apply-entry";

export const dynamic="force-dynamic";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const needed=["catalog.manage","pricing.manage",
  "catalog.reference_ranges.manage","catalog.configuration.apply"] as const;
const refuse=(error:string,status:number)=>NextResponse.json({error},
  {status,headers:{"Cache-Control":"private, no-store"}});
/**
 * No client-supplied approvals, installation IDs, signer assertions,
 * before/after snapshots, drift tokens, effective dates or plan digests.
 * This action obtains ALL of those from locked, signed current DB evidence.
 */
export async function POST(request:NextRequest,{params}:{
  params:Promise<{id:string}>;
}){
  if([...request.nextUrl.searchParams.keys()].length)
    return refuse("f2_apply_invalid_query",400);
  const origin=request.headers.get("origin");
  if(request.headers.get("sec-fetch-site")==="cross-site"||
     (origin && origin!==new URL(request.url).origin))
    return refuse("f2_apply_cross_site",403);
  if((request.headers.get("content-length")||"0")!=="0"||
     request.body!==null)
    return refuse("f2_apply_body_not_allowed",400);
  const session=await getCurrentSession();
  if(!session)return refuse("unauthorized",401);
  if(!needed.every(p=>permissionSet(session).has(p)))
    return refuse("f2_apply_operator_permission_required",403);
  const {id:batchId}=await params;
  if(!uuid.test(batchId))return refuse("f2_apply_not_found",404);
  try{
    const outcome=await prisma.$transaction(async tx=>{
      const [locked]=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM organizations
        WHERE id=${session.user.organizationId}
          AND status='ACTIVE'
        FOR UPDATE`;
      if(!locked)return {ok:false,code:"f2_apply_organization_inactive"} as const;
      return applyF2ConfigurationFromVerifiedDatabaseUnderLock(
        tx,session,batchId,new Date());
    },{isolationLevel:"RepeatableRead",timeout:120000});
    if(!outcome.ok)return refuse(outcome.code,409);
    return NextResponse.json(outcome.result,{
      headers:{"Cache-Control":"private, no-store"},
    });
  }catch{
    return refuse("f2_apply_transaction_conflict_or_invalid_history",409);
  }
}
