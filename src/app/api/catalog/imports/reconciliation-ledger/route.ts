import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { summarizeImportLedger, summarizeLedgerCollection } from "@/lib/legacy-import-ledger";

export const dynamic = "force-dynamic";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const fail = (error:string,status:number) => NextResponse.json({error},{status});

export async function GET(request:NextRequest) {
  const session=await getCurrentSession();
  if(!session)return fail("unauthorized",401);
  if(!permissionSet(session).has("catalog.manage"))return fail("forbidden",403);
  const keys=[...request.nextUrl.searchParams.keys()];
  if(keys.some(k=>k!=="cursor")||keys.filter(k=>k==="cursor").length>1)return fail("invalid_query",400);
  const cursor=request.nextUrl.searchParams.get("cursor");
  if(cursor&&!UUID.test(cursor))return fail("invalid_cursor",400);
  const organizationId=session.user.organizationId;
  const branchId=session.activeBranchId;
  if(!branchId||!session.user.branchScopes.some(x=>x.branchId===branchId&&
    x.branch.organizationId===organizationId&&x.branch.status==="ACTIVE"))return fail("active_branch_scope_required",403);
  const live=await prisma.user.findFirst({
    where:{id:session.userId,organizationId,status:"ACTIVE",
      organization:{status:"ACTIVE"},
      branchScopes:{some:{branchId,branch:{organizationId,status:"ACTIVE"}}},
      roles:{some:{role:{organizationId,status:"ACTIVE",
        permissions:{some:{permission:{code:"catalog.manage"}}}}}}},
    select:{id:true},
  });
  if(!live)return fail("live_import_read_authority_revoked",403);
  const limit=25;
  const batches=await prisma.catalogImportBatch.findMany({
    where:{organizationId},
    select:{id:true,sourceType:true,sourceName:true,sourceChecksum:true,status:true,
      createdAt:true,validatedAt:true,importedAt:true},
    orderBy:[{createdAt:"desc"},{id:"desc"}],
    take:limit+1,
    ...(cursor?{cursor:{id:cursor},skip:1}:{}),
  });
  const current=batches.slice(0,limit),ids=current.map(x=>x.id);
  const grouped=ids.length?await prisma.catalogImportRow.groupBy({
    by:["batchId","entityType","status"],
    where:{batchId:{in:ids},batch:{organizationId}},
    _count:{_all:true},
  }):[];
  const items=current.map(batch=>{
    const stats=summarizeImportLedger({
      id:batch.id,sourceType:batch.sourceType,sourceName:batch.sourceName,
      sourceChecksum:batch.sourceChecksum,status:batch.status,
      createdAt:batch.createdAt.toISOString(),validatedAt:batch.validatedAt?.toISOString()||null,
      importedAt:batch.importedAt?.toISOString()||null,
      counts:grouped.filter(x=>x.batchId===batch.id).map(x=>({
        entityType:x.entityType,status:x.status,_count:{_all:x._count._all},
      })),
    });
    return {
      id:batch.id,sourceType:batch.sourceType,sourceName:batch.sourceName,
      sourceChecksumPresent:!!batch.sourceChecksum,status:batch.status,
      createdAt:batch.createdAt.toISOString(),validatedAt:batch.validatedAt?.toISOString()||null,
      importedAt:batch.importedAt?.toISOString()||null,
      ...stats,
    };
  });
  return NextResponse.json({
    items,pageTotals:summarizeLedgerCollection(items),
    nextCursor:batches.length>limit?current.at(-1)?.id:null,
    caveat:"This is a paginated staging ledger, not source-to-target certification. Clinical, billing, and source-row reconciliation still require signed expert review.",
  },{headers:{"Cache-Control":"no-store"}});
}
