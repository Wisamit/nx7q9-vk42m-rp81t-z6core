import { NextResponse } from "next/server";
import { canAccessBranch, canAccessDepartment, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string; eventId: string }> }) {
  const session = await requirePermission("reflex.review");
  const ctx = await requestContext();
  const { id, eventId } = await params;
  const body = await request.json().catch(() => null) as { action?: string; note?: string } | null;

  const action = body?.action === "ACKNOWLEDGE" ? "ACKNOWLEDGED" : body?.action === "DISMISS" ? "DISMISSED" : null;
  if (!action) return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  const event = await prisma.reflexRuleEvent.findFirst({
    where: { id: eventId, resultId: id, result: { organizationId: session.user.organizationId } },
    include: {
      result: { include: { orderItem: { include: { test: { select: { departmentId: true } } } } } },
      rule: { include: { targetTest: true } },
    },
  });
  if (!event) return NextResponse.json({ error: "reflex_event_not_found" }, { status: 404 });
  if (!canAccessBranch(session, event.result.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (!canAccessDepartment(session, event.result.orderItem.test.departmentId)) {
    return NextResponse.json({ error: "department_forbidden" }, { status: 403 });
  }
  if (event.status !== "PENDING") {
    return NextResponse.json({ error: "reflex_event_not_pending", status: event.status }, { status: 409 });
  }

  const reviewedAt = new Date();
  const note = text(body?.note);

  const outcome = await prisma.$transaction(async tx => {
    // The event status and permissions MUST be rechecked inside the mutation
    // transaction. The initial snapshot is only a UX preflight.
    const liveActor=await tx.user.findFirst({where:{
      id:session.user.id,organizationId:session.user.organizationId,status:"ACTIVE",
      roles:{some:{role:{organizationId:session.user.organizationId,status:"ACTIVE",
        permissions:{some:{permission:{code:"reflex.review"}}}}}},
      branchScopes:{some:{branchId:event.result.performingBranchId,branch:{
        organizationId:session.user.organizationId,status:"ACTIVE",
      }}},
    },select:{id:true}});
    if(!liveActor) return {error:"reflex_authority_revoked",httpStatus:403} as const;
    const liveDepartmentGrants=await tx.userDepartmentScope.findMany({
      where:{userId:session.user.id},select:{departmentId:true},
    });
    const departmentId=event.result.orderItem.test.departmentId;
    const liveDepartmentIds=liveDepartmentGrants.map(grant=>grant.departmentId);
    if(departmentId && liveDepartmentIds.length>0 &&
       !liveDepartmentIds.includes(departmentId))
      return {error:"reflex_department_scope_changed",httpStatus:403} as const;
    if(session.user.departmentScopes.length>0 && departmentId &&
       !liveDepartmentIds.includes(departmentId))
      return {error:"reflex_department_scope_revoked",httpStatus:403} as const;

    // Conditional one-winner claim prevents two simultaneous reviewers
    // from overwriting the action, reviewer or audit history.
    const claimed = await tx.reflexRuleEvent.updateMany({
      where: {id:event.id,resultId:id,status:"PENDING",
        result:{organizationId:session.user.organizationId,
          performingBranchId:event.result.performingBranchId}},
      data: {
        status:action,reviewedByUserId:session.user.id,
        reviewedAt,reviewNote:note||null,
      },
    });
    if(claimed.count!==1)
      return {error:"reflex_event_changed_since_review",httpStatus:409} as const;
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: event.result.performingBranchId,
        actorUserId: session.user.id,
        action: action === "ACKNOWLEDGED" ? "REFLEX_RECOMMENDATION_ACKNOWLEDGED" : "REFLEX_RECOMMENDATION_DISMISSED",
        entityType: "ReflexRuleEvent",
        entityId: event.id,
        oldValues: { status: "PENDING" },
        newValues: {
          status: action,
          resultId: event.resultId,
          targetTestId: event.rule.targetTestId,
          targetTestCode: event.rule.targetTest.code,
          reviewedAt,
        },
        reason: note || null,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return {status:"ok" as const,reflexStatus:action};
  },{isolationLevel:"ReadCommitted",timeout:30000});
  if("error" in outcome && typeof outcome.error==="string")
    return NextResponse.json({error:outcome.error},
      {status:outcome.httpStatus,headers:{"Cache-Control":"private, no-store"}});
  return NextResponse.json(outcome,{headers:{"Cache-Control":"private, no-store"}});

}
