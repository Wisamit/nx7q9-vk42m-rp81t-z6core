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
  const policy=await prisma.$transaction(async tx=>{
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
  });
  return NextResponse.json({status:"ok",policy});
}
