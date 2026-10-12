import { NextResponse } from "next/server";
import { canAccessBranch, getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { effectiveDiscountLimit } from "@/lib/discount-policy";
import { consumeStaffStepUp, StaffStepUpError } from "@/lib/staff-step-up";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("billing.discount.approve")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const action = body.action === "APPROVE" || body.action === "REJECT" ? body.action : null;
  const note = text(body.note);
  if (!action) return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  const approval = await prisma.discountApprovalRequest.findFirst({
    where: {
      id,
      organizationId: session.user.organizationId,
    },
  });
  if (!approval) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!canAccessBranch(session, approval.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const now = new Date();
  if (approval.status !== "PENDING") {
    return NextResponse.json({ error: "approval_not_pending", status: approval.status }, { status: 409 });
  }
  if (approval.expiresAt <= now) {
    await prisma.discountApprovalRequest.updateMany({
      where: { id: approval.id, status: "PENDING" },
      data: { status: "EXPIRED" },
    });
    return NextResponse.json({ error: "approval_expired" }, { status: 409 });
  }

  const approverLimit = effectiveDiscountLimit({
    userOverride: session.user.discountLimitPercent,
    roleLimits: session.user.roles
      .filter(assignment => assignment.role.status === "ACTIVE")
      .map(assignment => assignment.role.discountLimitPercent),
  });
  const requestedPercent = Number(approval.discountPercent.toString());

  if (action === "APPROVE" && requestedPercent > approverLimit) {
    return NextResponse.json({
      error: "discount_limit_exceeded",
      requestedPercent: approval.discountPercent.toString(),
      approverLimitPercent: approverLimit.toFixed(2),
    }, { status: 403 });
  }

  const ctx = await requestContext();
  const updated = await prisma.$transaction(async tx => {
    const stepUp=action==="APPROVE" ? await consumeStaffStepUp(tx,{
      token:request.headers.get("x-staff-step-up-token"),action:"DISCOUNT_APPROVAL",
      resourceKey:approval.id,sessionId:session.id,userId:session.user.id,
      organizationId:session.user.organizationId,branchId:approval.branchId,
      ipAddress:ctx.ipAddress,userAgent:ctx.userAgent,
    }) : null;
    const changed = await tx.discountApprovalRequest.updateMany({
      where: {
        id: approval.id,
        organizationId: session.user.organizationId,
        status: "PENDING",
        expiresAt: { gt: now },
      },
      data: action === "APPROVE"
        ? {
            status: "APPROVED",
            approvedByUserId: session.user.id,
            approvedAt: now,
            approvalNote: note || null,
          }
        : {
            status: "REJECTED",
            rejectedAt: now,
            approvalNote: note || null,
          },
    });
    if (changed.count !== 1) throw new Error("APPROVAL_STATE_CHANGED");

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: approval.branchId,
        actorUserId: session.user.id,
        action: action === "APPROVE" ? "DISCOUNT_APPROVAL_APPROVED" : "DISCOUNT_APPROVAL_REJECTED",
        entityType: "DiscountApprovalRequest",
        entityId: approval.id,
        oldValues: { status: approval.status },
        newValues: {
          status: action === "APPROVE" ? "APPROVED" : "REJECTED",
          discountPercent: approval.discountPercent.toString(),
          requesterUserId: approval.requestedByUserId,
          approverLimitPercent: approverLimit.toFixed(2),
          note: note || null,
          stepUpGrantId:stepUp?.grantId||null,stepUpProofMethod:stepUp?.proofMethod||null,
        },
        reason: approval.reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return tx.discountApprovalRequest.findUnique({ where: { id: approval.id } });
  }).catch(error => error instanceof StaffStepUpError ? "STEP_UP_REQUIRED" as const : null);

  if(updated==="STEP_UP_REQUIRED")
    return NextResponse.json({error:"fresh_staff_reauthentication_required"},{status:403});
  if (!updated) return NextResponse.json({ error: "approval_state_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok", approvalStatus: updated.status });
}
