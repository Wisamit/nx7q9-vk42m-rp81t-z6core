import type { Prisma } from "../../../../../generated/prisma/client";
import { NextResponse } from "next/server";
import {
  authorizedDepartmentIds, canAccessBranch, getCurrentSession,
  permissionSet, requestContext,
} from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  InterpretationError, interpretationFingerprint, interpretationReviewError,
  parseInterpretationDecision, parseInterpretationDraft,
} from "@/lib/report-interpretation";

type Session = NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>;
async function lockedOrder(tx: Prisma.TransactionClient,
  orderId: string, session: Session) {
  const organizationId=session.user.organizationId;
  const rows=await tx.$queryRaw<Array<{id:string}>>`
    SELECT id FROM orders WHERE id=${orderId}
    AND organization_id=${organizationId} FOR UPDATE
  `;
  if(rows.length!==1)throw new InterpretationError("order_not_found",404);
  const order=await tx.labOrder.findFirst({
    where:{id:orderId,organizationId},
    include:{items:{where:{status:{not:"CANCELLED"}},
      include:{test:{select:{departmentId:true}}}}},
  });
  if(!order)throw new InterpretationError("order_not_found",404);
  if(!canAccessBranch(session,order.orderingBranchId))
    throw new InterpretationError("ordering_branch_forbidden",403);
  const branch=await tx.branch.findFirst({where:{id:order.orderingBranchId,
    organizationId,status:"ACTIVE"},select:{id:true}});
  const grant=await tx.userBranchScope.findUnique({where:{userId_branchId:{
    userId:session.user.id,branchId:order.orderingBranchId,
  }},select:{branchId:true}});
  if(!branch||!grant)throw new InterpretationError("active_branch_scope_required",403);
  const allowed=authorizedDepartmentIds(session);
  if(allowed.length && order.items.some(item=>item.test.departmentId &&
    !allowed.includes(item.test.departmentId)))
    throw new InterpretationError("order_department_scope_forbidden",403);
  return order;
}

export async function POST(request: Request) {
  const session=await getCurrentSession();
  if(!session)return NextResponse.json({error:"unauthorized"},{status:401});
  const rights=permissionSet(session);
  if(!rights.has("results.medical_validate")||!rights.has("reports.view"))
    return NextResponse.json({error:"interpretation_author_permission_required"},{status:403});
  let data;
  try {data=parseInterpretationDraft(await request.json().catch(()=>null));}
  catch(error){return failed(error);}
  const context=await requestContext();
  try {
    const created=await prisma.$transaction(async tx=>{
      const order=await lockedOrder(tx,data.orderId,session);
      if(order.items.length===0)throw new InterpretationError("order_has_no_active_tests");
      const latest=await tx.reportInterpretiveComment.findFirst({
        where:{orderId:order.id,organizationId:session.user.organizationId},
        orderBy:[{revisionNumber:"desc"},{createdAt:"desc"}],
      });
      if(latest?.status==="DRAFT")throw new InterpretationError("review_pending_for_order");
      const predecessor=await tx.reportInterpretiveComment.findFirst({
        where:{orderId:order.id,organizationId:session.user.organizationId,status:"APPROVED"},
        orderBy:{revisionNumber:"desc"},
      });
      if(predecessor && predecessor.textEn===data.textEn && predecessor.textAr===data.textAr)
        throw new InterpretationError("identical_to_approved_interpretation");
      const note=await tx.reportInterpretiveComment.create({data:{
        organizationId:session.user.organizationId,orderId:order.id,
        revisionNumber:(latest?.revisionNumber??0)+1,
        textEn:data.textEn,textAr:data.textAr,
        supersedesCommentId:predecessor?.id??null,
        createdByUserId:session.user.id,status:"DRAFT",
      }});
      await tx.auditEvent.create({data:{
        organizationId:session.user.organizationId,branchId:order.orderingBranchId,
        actorUserId:session.user.id,entityType:"ReportInterpretiveComment",
        entityId:note.id,action:"REPORT_INTERPRETATION_DRAFT_CREATED",
        newValues:{orderId:order.id,revisionNumber:note.revisionNumber,
          supersedesCommentId:note.supersedesCommentId,
          fingerprint:interpretationFingerprint(note),status:"DRAFT"},
        ipAddress:context.ipAddress,userAgent:context.userAgent,
      }});
      return note;
    },{isolationLevel:"Serializable",timeout:45000});
    return NextResponse.json({id:created.id,status:"DRAFT"},{status:201,
      headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return failed(error);}
}

export async function PATCH(request: Request) {
  const session=await getCurrentSession();
  if(!session)return NextResponse.json({error:"unauthorized"},{status:401});
  const rights=permissionSet(session);
  if(!rights.has("results.release")||!rights.has("reports.view"))
    return NextResponse.json({error:"interpretation_approval_permission_required"},{status:403});
  let data;
  try {data=parseInterpretationDecision(await request.json().catch(()=>null));}
  catch(error){return failed(error);}
  const context=await requestContext();
  try {
    const updated=await prisma.$transaction(async tx=>{
      const hint=await tx.reportInterpretiveComment.findFirst({
        where:{id:data.id,organizationId:session.user.organizationId},
        select:{orderId:true},
      });
      if(!hint)throw new InterpretationError("interpretation_not_found",404);
      const order=await lockedOrder(tx,hint.orderId,session);
      const note=await tx.reportInterpretiveComment.findFirst({
        where:{id:data.id,organizationId:session.user.organizationId,orderId:order.id},
      });
      if(!note)throw new InterpretationError("interpretation_not_found",404);
      const latest=await tx.reportInterpretiveComment.findFirst({
        where:{orderId:order.id,organizationId:session.user.organizationId},
        orderBy:{revisionNumber:"desc"},
        select:{id:true},
      });
      if(latest?.id!==note.id)throw new InterpretationError("interpretation_stale");
      const predecessor=note.supersedesCommentId
        ? await tx.reportInterpretiveComment.findFirst({
          where:{id:note.supersedesCommentId,organizationId:session.user.organizationId},
          select:{id:true,status:true,orderId:true},
        }):null;
      const invalid=interpretationReviewError(note,session.user.id,data.expectedFingerprint,predecessor);
      if(invalid)throw new InterpretationError(invalid);
      const nextStatus=data.decision==="APPROVE"?"APPROVED":"REJECTED";
      if(data.decision==="APPROVE" && predecessor) {
        const changed=await tx.reportInterpretiveComment.updateMany({
          where:{id:predecessor.id,orderId:order.id,status:"APPROVED"},
          data:{status:"RETIRED"},
        });
        if(changed.count!==1)throw new InterpretationError("interpretation_predecessor_changed");
        await tx.auditEvent.create({data:{
          organizationId:session.user.organizationId,branchId:order.orderingBranchId,
          actorUserId:session.user.id,entityType:"ReportInterpretiveComment",
          entityId:predecessor.id,action:"REPORT_INTERPRETATION_SUPERSEDED",
          oldValues:{status:"APPROVED"},
          newValues:{status:"RETIRED",supersededById:note.id},
          reason:data.reason,ipAddress:context.ipAddress,userAgent:context.userAgent,
        }});
      }
      const changed=await tx.reportInterpretiveComment.updateMany({
        where:{id:note.id,organizationId:session.user.organizationId,status:"DRAFT"},
        data:{status:nextStatus,approvedByUserId:session.user.id,
          approvedAt:new Date(),reviewReason:data.reason},
      });
      if(changed.count!==1)throw new InterpretationError("interpretation_stale");
      await tx.auditEvent.create({data:{
        organizationId:session.user.organizationId,branchId:order.orderingBranchId,
        actorUserId:session.user.id,entityType:"ReportInterpretiveComment",
        entityId:note.id,
        action:data.decision==="APPROVE"?
          "REPORT_INTERPRETATION_INDEPENDENTLY_APPROVED":"REPORT_INTERPRETATION_REJECTED",
        oldValues:{status:"DRAFT",fingerprint:data.expectedFingerprint},
        newValues:{status:nextStatus,revisionNumber:note.revisionNumber,
          supersedesCommentId:note.supersedesCommentId,appliesTo:"FUTURE_REPORT_VERSIONS_ONLY"},
        reason:data.reason,ipAddress:context.ipAddress,userAgent:context.userAgent,
      }});
      return nextStatus;
    },{isolationLevel:"Serializable",timeout:45000});
    return NextResponse.json({status:updated},{headers:{"Cache-Control":"private, no-store"}});
  }catch(error){return failed(error);}
}
function failed(error:unknown){
  if(error instanceof InterpretationError)
    return NextResponse.json({error:error.code},{status:error.statusCode});
  return NextResponse.json({error:"interpretation_concurrent_conflict"},{status:409});
}
