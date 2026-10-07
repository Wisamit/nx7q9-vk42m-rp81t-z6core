import { NextResponse } from "next/server";
import { canAccessBranch, getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { cashierClosureReviewError } from "@/lib/cashier-shift-policy";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

class ReviewConflict extends Error {}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("billing.cashier.approve")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const action = body.action === "APPROVE" || body.action === "REJECT" ? body.action : null;
  const note = text(body.note);
  if (!action) return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  const closure = await prisma.cashierShiftClosure.findUnique({
    where: { id },
    include: { cashierShift: true },
  });
  if (!closure || closure.cashierShift.organizationId !== session.user.organizationId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!canAccessBranch(session, closure.cashierShift.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const policyError = cashierClosureReviewError({
    closureStatus: closure.status,
    shiftStatus: closure.cashierShift.status,
    cashierUserId: closure.cashierShift.cashierUserId,
    reviewerUserId: session.user.id,
    action,
    note,
  });
  if (policyError) return NextResponse.json({ error: policyError }, { status: 409 });

  const ctx = await requestContext();
  try {
    await prisma.$transaction(async tx => {
      const changedClosure = await tx.cashierShiftClosure.updateMany({
        where: { id, status: "PENDING", reviewedAt: null },
        data: {
          status: action === "APPROVE" ? "APPROVED" : "REJECTED",
          reviewedByUserId: session.user.id,
          reviewedAt: new Date(),
          reviewNote: note || null,
        },
      });
      if (changedClosure.count !== 1) throw new ReviewConflict();

      const changedShift = await tx.cashierShift.updateMany({
        where: {
          id: closure.cashierShiftId,
          status: "PENDING_APPROVAL",
          activityVersion: closure.activityVersionSnapshot,
        },
        data: action === "APPROVE"
          ? {
              status: "CLOSED",
              activeKey: null,
              closedAt: new Date(),
              activityVersion: { increment: 1 },
            }
          : {
              status: "OPEN",
              activityVersion: { increment: 1 },
            },
      });
      if (changedShift.count !== 1) throw new ReviewConflict();

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: closure.cashierShift.branchId,
          actorUserId: session.user.id,
          action: action === "APPROVE" ? "CASHIER_SHIFT_CLOSING_APPROVED" : "CASHIER_SHIFT_CLOSING_REJECTED",
          entityType: "CashierShiftClosure",
          entityId: closure.id,
          oldValues: { closureStatus: closure.status, shiftStatus: closure.cashierShift.status },
          newValues: {
            closureStatus: action === "APPROVE" ? "APPROVED" : "REJECTED",
            shiftStatus: action === "APPROVE" ? "CLOSED" : "OPEN",
            shiftId: closure.cashierShiftId,
            shiftNumber: closure.cashierShift.shiftNumber,
            currency: closure.cashierShift.currency,
            expectedCash: closure.expectedCashSnapshot.toFixed(4),
            actualCash: closure.actualCash.toFixed(4),
            differenceAmount: closure.differenceAmount.toFixed(4),
            note: note || null,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
    }, { timeout: 30000 });
  } catch (error) {
    if (error instanceof ReviewConflict) return NextResponse.json({ error: "closure_state_changed" }, { status: 409 });
    throw error;
  }

  return NextResponse.json({ status: "ok", closureStatus: action === "APPROVE" ? "APPROVED" : "REJECTED" });
}
