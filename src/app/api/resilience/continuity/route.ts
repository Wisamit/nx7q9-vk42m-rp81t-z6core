import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request:Request){
  const session=await requirePermission("resilience.manage");
  const ctx=await requestContext();
  const body=await request.json().catch(()=>null);
  const branchId=typeof body?.branchId==="string"?body.branchId.trim():"";
  const mode=["CENTRAL_ONLY","READ_ONLY_CACHE","BUFFER_NON_CLINICAL"].includes(body?.mode)?body.mode:"CENTRAL_ONLY";
  const localBufferMinutes=body?.localBufferMinutes===""||body?.localBufferMinutes==null?null:Number(body.localBufferMinutes);
  if(!branchId||!canAccessBranch(session,branchId)) return NextResponse.json({error:"branch_forbidden"},{status:403});
  if(localBufferMinutes!==null&&(!Number.isInteger(localBufferMinutes)||localBufferMinutes<1||localBufferMinutes>1440)) return NextResponse.json({error:"invalid_buffer_minutes"},{status:400});
  let policy;
  try {
    policy=await prisma.$transaction(async tx=>{
      // Lock branch before switching mode; edge sync and registration use the same mutex.
      const locked=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM branches WHERE id=${branchId}
        AND organization_id=${session.user.organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      if(locked.length!==1) throw new Error("BRANCH_NOT_ACTIVE");
    const saved=await tx.branchContinuityPolicy.upsert({
      where:{branchId},
      update:{mode,offlineClinicalWritesAllowed:false,localBufferMinutes:mode==="BUFFER_NON_CLINICAL"?localBufferMinutes:null,notes:typeof body.notes==="string"?body.notes.trim().slice(0,1000)||null:null,updatedByUserId:session.user.id},
      create:{branchId,mode,offlineClinicalWritesAllowed:false,localBufferMinutes:mode==="BUFFER_NON_CLINICAL"?localBufferMinutes:null,notes:typeof body.notes==="string"?body.notes.trim().slice(0,1000)||null:null,updatedByUserId:session.user.id},
    });
    await tx.auditEvent.create({data:{
      organizationId:session.user.organizationId,branchId,actorUserId:session.user.id,
      action:"BRANCH_CONTINUITY_POLICY_UPDATED",entityType:"BranchContinuityPolicy",entityId:saved.id,
      newValues:{mode,offlineClinicalWritesAllowed:false,localBufferMinutes:saved.localBufferMinutes},
      reason:"Offline clinical writes remain disabled; buffered mode is limited to future non-clinical edge workflows.",
      ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    }});
    return saved;
    },{isolationLevel:"Serializable",timeout:30000});
  } catch {
    return NextResponse.json({error:"continuity_policy_conflict_or_branch_inactive"},{status:409});
  }
  return NextResponse.json({status:"ok",policy});
}
