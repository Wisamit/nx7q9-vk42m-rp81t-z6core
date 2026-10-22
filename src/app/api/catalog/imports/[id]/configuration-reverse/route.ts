import {NextRequest,NextResponse} from "next/server";
import {getCurrentSession,permissionSet} from "@/lib/auth";
import {prisma} from "@/lib/db";
import {applyF2ConfigurationFromVerifiedDatabaseUnderLock}
  from "@/lib/catalog-f2-apply-entry";

export const dynamic="force-dynamic";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const required=["catalog.manage","pricing.manage",
  "catalog.reference_ranges.manage","catalog.configuration.reverse"] as const;
const refuse=(error:string,status:number)=>NextResponse.json({error},{
  status,headers:{"Cache-Control":"private, no-store"},
});
/**
 * Bodyless future-only compensating reversal. The requester cannot supply
 * approvals, before-snapshots, installation identity, an effective date or
 * a plan. Under the tenant lock all evidence is read from signed SQL journals
 * and checked again against current independent signer permissions.
 *
 * No destructive rollback after the effective date: a new prospective
 * governed amendment is required in that case.
 */
export async function POST(request:NextRequest,{params}:{
  params:Promise<{id:string}>;
}){
  if([...request.nextUrl.searchParams.keys()].length)
    return refuse("f2_reverse_invalid_query",400);
  const origin=request.headers.get("origin");
  if(request.headers.get("sec-fetch-site")==="cross-site"||
     (origin&&origin!==new URL(request.url).origin))
    return refuse("f2_reverse_cross_site",403);
  if((request.headers.get("content-length")||"0")!=="0"||
     request.body!==null)
    return refuse("f2_reverse_body_forbidden",400);
  const session=await getCurrentSession();
  if(!session)return refuse("unauthorized",401);
  if(!required.every(code=>permissionSet(session).has(code)))
    return refuse("f2_reverse_operator_permission_required",403);
  const {id:batchId}=await params;
  if(!UUID.test(batchId))return refuse("f2_reverse_not_found",404);
  try{
    const result=await prisma.$transaction(async tx=>{
      const [locked]=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM organizations WHERE id=${session.user.organizationId}
          AND status='ACTIVE' FOR UPDATE`;
      if(!locked)return {ok:false,code:"f2_reverse_organization_inactive"} as const;
      return applyF2ConfigurationFromVerifiedDatabaseUnderLock(
        tx,session,batchId,new Date(),"REVERSE",
      );
    },{isolationLevel:"RepeatableRead",timeout:120000});
    if(!result.ok)return refuse(result.code,409);
    return NextResponse.json(result.result,{headers:{"Cache-Control":"private, no-store"}});
  }catch{
    return refuse("f2_reverse_transaction_conflict_or_unverified_journal",409);
  }
}
