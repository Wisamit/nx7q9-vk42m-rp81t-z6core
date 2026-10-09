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
  let result;
  try {
    result=await prisma.$transaction(async tx=>{
      // Lock the same organization row as policy mutations before reading live policy.
      const locked=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM organizations WHERE id=${session.user.organizationId}
        AND status='ACTIVE' FOR UPDATE
      `;
      if(locked.length!==1) throw new Error("RETENTION_POLICY_CHANGED");
      const policy=await tx.retentionPolicy.findFirst({where:{
        id:policyId,organizationId:session.user.organizationId,
      }});
      if(!policy||!policy.enabled||policy.action!=="PURGE"||
         !inAppPurgeClasses.has(policy.dataClass)||!policy.retainDays) {
        throw new Error("RETENTION_POLICY_CHANGED");
      }
      // Never execute a previously-previewed cutoff when the configured retention
      // horizon has been lengthened or the policy disabled in another request.
      const cutoff=retentionCutoff(policy.retainDays);
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
    return {count,cutoff};
    },{isolationLevel:"Serializable",timeout:30000});
  } catch {
    return NextResponse.json({error:"retention_policy_changed_or_execution_conflict"},{status:409});
  }
  return NextResponse.json({status:"ok",deletedCount:result.count,cutoff:result.cutoff});
}
