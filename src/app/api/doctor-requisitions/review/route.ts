import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { DoctorRequisitionError, isUuid, validRequisitionDecisionReason } from "@/lib/doctor-requisition";

export async function PATCH(request:Request) {
  const session=await requirePermission("orders.create");
  const organizationId=session.user.organizationId;
  const body:unknown=await request.json().catch(()=>null);
  if(!body || typeof body!=="object" || Array.isArray(body))
    return NextResponse.json({error:"invalid_request"},{status:400});
  const input=body as Record<string,unknown>;
  if(!isUuid(input.id) || input.decision!=="DECLINE" ||
    !validRequisitionDecisionReason(input.reason))
    return NextResponse.json({error:"invalid_review_decision"},{status:400});
  const ctx=await requestContext();
  try {
    const outcome=await prisma.$transaction(async tx=>{
      const locked=await tx.$queryRaw<Array<{id:string;branch_id:string}>>`
        SELECT id, branch_id FROM doctor_requisitions
        WHERE id=${input.id} AND organization_id=${organizationId} FOR UPDATE`;
      if(locked.length!==1)throw new DoctorRequisitionError("requisition_not_found",404);
      const branchId=locked[0].branch_id;
      if(!canAccessBranch(session,branchId))
        throw new DoctorRequisitionError("branch_forbidden",403);
      const scope=await tx.userBranchScope.findUnique({
        where:{userId_branchId:{userId:session.user.id,branchId}},select:{branchId:true}});
      const branch=await tx.branch.findFirst({
        where:{id:branchId,organizationId,status:"ACTIVE"},select:{id:true}});
      if(!scope || !branch)throw new DoctorRequisitionError("active_branch_scope_required",403);
      const changed=await tx.doctorRequisition.updateMany({
        where:{id:input.id as string,organizationId,branchId,status:"SUBMITTED"},
        data:{status:"DECLINED",resolvedAt:new Date(),
          resolvedByUserId:session.user.id,resolutionReason:(input.reason as string).trim()},
      });
      if(changed.count!==1)throw new DoctorRequisitionError("requisition_not_pending");
      await tx.auditEvent.create({data:{
        organizationId,branchId,actorUserId:session.user.id,
        action:"DOCTOR_ELECTRONIC_REQUISITION_DECLINED",
        entityType:"DoctorRequisition",entityId:input.id as string,
        oldValues:{status:"SUBMITTED"},newValues:{status:"DECLINED"},
        reason:(input.reason as string).trim(),
        ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
      }});
      return {id:input.id,status:"DECLINED"};
    },{isolationLevel:"Serializable",timeout:45000});
    return NextResponse.json(outcome,{headers:{"Cache-Control":"private, no-store"}});
  }catch(error) {
    if(error instanceof DoctorRequisitionError)
      return NextResponse.json({error:error.code},{status:error.statusCode});
    return NextResponse.json({error:"requisition_review_conflict"},{status:409});
  }
}
