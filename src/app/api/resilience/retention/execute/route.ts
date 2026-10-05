import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { inAppPurgeClasses, retentionCutoff } from "@/lib/retention";

export async function POST(request:Request){
  const session=await requirePermission("resilience.archive");
  const ctx=await requestContext();
  const body=await request.json().catch(()=>null) as {policyId?:unknown;confirm?:unknown}|null;
  const policyId=typeof body?.policyId==="string"?body.policyId:"";
  if(body?.confirm!=="PURGE_EXPIRED_SESSIONS") return NextResponse.json({error:"explicit_confirmation_required"},{status:400});
  const policy=await prisma.retentionPolicy.findFirst({where:{id:policyId,organizationId:session.user.organizationId}});
  if(!policy||!policy.enabled) return NextResponse.json({error:"active_retention_policy_not_found"},{status:404});
  if(policy.action!=="PURGE"||!inAppPurgeClasses.has(policy.dataClass)) return NextResponse.json({error:"in_app_purge_not_allowed_for_data_class"},{status:409});
  if(!policy.retainDays) return NextResponse.json({error:"retain_days_required"},{status:409});
  const cutoff=retentionCutoff(policy.retainDays);

  const deleted=await prisma.$transaction(async tx=>{
    let count=0;
    if(policy.dataClass==="USER_SESSIONS"){
      const result=await tx.userSession.deleteMany({where:{
        user:{organizationId:session.user.organizationId},
        OR:[{expiresAt:{lte:cutoff}},{revokedAt:{not:null,lte:cutoff}}],
      }});
      count=result.count;
    } else if(policy.dataClass==="PORTAL_SESSIONS"){
      const result=await tx.portalSession.deleteMany({where:{
        portalAccount:{organizationId:session.user.organizationId},
        OR:[{expiresAt:{lte:cutoff}},{revokedAt:{not:null,lte:cutoff}}],
      }});
      count=result.count;
    }
    await tx.auditEvent.create({data:{
      organizationId:session.user.organizationId,branchId:session.activeBranchId,actorUserId:session.user.id,
      action:"RETENTION_PURGE_EXECUTED",entityType:"RetentionPolicy",entityId:policy.id,
      oldValues:{dataClass:policy.dataClass,retainDays:policy.retainDays},
      newValues:{deletedCount:count,cutoff},
      reason:"Only expired/revoked authentication sessions are eligible for in-app purge.",
      ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    }});
    return count;
  });
  return NextResponse.json({status:"ok",deletedCount:deleted,cutoff});
}
