import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { cashierClosingSnapshot } from "@/lib/cashier-shift-policy";
import { money4ToMinor, minorToMoney4 } from "@/lib/billing-adjustments";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

class ShiftConflict extends Error {}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("billing.manage");
  const ctx = await requestContext();
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const actualCashText = typeof body.actualCash === "string" || typeof body.actualCash === "number"
    ? String(body.actualCash)
    : "";
  const notes = text(body.notes);
  const actualCash = money4ToMinor(actualCashText);
  if (actualCash === null) return NextResponse.json({ error: "invalid_actual_cash" }, { status: 400 });

  const shift = await prisma.cashierShift.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!shift) return NextResponse.json({ error: "shift_not_found" }, { status: 404 });
  if (!canAccessBranch(session, shift.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (shift.cashierUserId !== session.user.id) return NextResponse.json({ error: "cashier_mismatch" }, { status: 403 });
  if (shift.status !== "OPEN") return NextResponse.json({ error: "shift_not_open" }, { status: 409 });

  try {
    const result = await prisma.$transaction(async tx => {
      const current = await tx.cashierShift.findUnique({ where: { id } });
      if (!current || current.status !== "OPEN" || current.cashierUserId !== session.user.id) throw new ShiftConflict();

      const frozen = await tx.cashierShift.updateMany({
        where: { id, status: "OPEN", activityVersion: current.activityVersion },
        data: { status: "PENDING_APPROVAL", activityVersion: { increment: 1 } },
      });
      if (frozen.count !== 1) throw new ShiftConflict();

      const [payments, refunds, attemptCount] = await Promise.all([
        tx.payment.findMany({
          where: { cashierShiftId: id, status: { not: "VOIDED" } },
          select: { amount: true, method: true },
        }),
        tx.refund.findMany({
          where: { cashierShiftId: id, status: "POSTED" },
          select: { amount: true, method: true },
        }),
        tx.cashierShiftClosure.count({ where: { cashierShiftId: id } }),
      ]);

      const zero = current.openingCash.mul(0);
      const cashReceipts = payments
        .filter(item => item.method === "CASH")
        .reduce((sum, item) => sum.add(item.amount), zero);
      const cashRefunds = refunds
        .filter(item => item.method === "CASH")
        .reduce((sum, item) => sum.add(item.amount), zero);
      const snapshot = cashierClosingSnapshot({
        openingCash: current.openingCash.toFixed(4),
        cashReceipts: cashReceipts.toFixed(4),
        cashRefunds: cashRefunds.toFixed(4),
        actualCash: minorToMoney4(actualCash),
      });
      if (!snapshot) throw new Error("INVALID_CLOSING_SNAPSHOT");

      const closure = await tx.cashierShiftClosure.create({
        data: {
          cashierShiftId: id,
          attemptNumber: attemptCount + 1,
          activityVersionSnapshot: current.activityVersion + 1,
          openingCashSnapshot: current.openingCash,
          cashReceiptsSnapshot: cashReceipts,
          cashRefundsSnapshot: cashRefunds,
          expectedCashSnapshot: snapshot.expectedCash,
          actualCash: minorToMoney4(actualCash),
          differenceAmount: snapshot.differenceAmount,
          paymentCountSnapshot: payments.length,
          cashPaymentCountSnapshot: payments.filter(item => item.method === "CASH").length,
          refundCountSnapshot: refunds.length,
          cashRefundCountSnapshot: refunds.filter(item => item.method === "CASH").length,
          notes: notes || null,
          submittedByUserId: session.user.id,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: current.branchId,
          actorUserId: session.user.id,
          action: "CASHIER_SHIFT_CLOSING_SUBMITTED",
          entityType: "CashierShiftClosure",
          entityId: closure.id,
          newValues: {
            shiftId: current.id,
            shiftNumber: current.shiftNumber,
            currency: current.currency,
            openingCash: current.openingCash.toFixed(4),
            cashReceipts: cashReceipts.toFixed(4),
            cashRefunds: cashRefunds.toFixed(4),
            expectedCash: snapshot.expectedCash,
            actualCash: minorToMoney4(actualCash),
            differenceAmount: snapshot.differenceAmount,
            paymentCount: payments.length,
            refundCount: refunds.length,
            attemptNumber: attemptCount + 1,
            notes: notes || null,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return {
        closureId: closure.id,
        expectedCash: snapshot.expectedCash,
        actualCash: minorToMoney4(actualCash),
        differenceAmount: snapshot.differenceAmount,
      };
    }, { timeout: 30000 });

    return NextResponse.json({ status: "ok", ...result }, { status: 201 });
  } catch (error) {
    if (error instanceof ShiftConflict) return NextResponse.json({ error: "shift_changed" }, { status: 409 });
    throw error;
  }
}
