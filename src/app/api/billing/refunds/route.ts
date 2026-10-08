import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { invoiceAdjustmentState, refundError } from "@/lib/billing-adjustments";
import { prisma } from "@/lib/db";
import { paymentMethodReferenceError, paymentMethodSnapshot, resolveSettlementPaymentMethod } from "@/lib/payment-methods";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function documentNumber(prefix: string, branchCode: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${prefix}-${branchCode}-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`.slice(0, 50);
}

class FinancialConflict extends Error {
  constructor(public readonly code: "invoice_changed" | "payment_changed" | "cashier_shift_changed") {
    super(code);
  }
}

export async function POST(request: Request) {
  const session = await requirePermission("billing.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const paymentId = text(body.paymentId, 36);
  const invoiceId = text(body.invoiceId, 36);
  const reason = text(body.reason, 1000);
  const reference = text(body.reference, 150);
  const paymentMethodId = text(body.paymentMethodId, 36);
  const legacyMethod = text(body.method, 60);
  const amountText = typeof body.amount === "string" || typeof body.amount === "number" ? String(body.amount) : "";

  if (!paymentId || !invoiceId || !reason || (!paymentMethodId && !legacyMethod) || !/^\d+(\.\d{1,4})?$/.test(amountText)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  const amount = new Prisma.Decimal(amountText);
  if (amount.lte(0)) return NextResponse.json({ error: "invalid_amount" }, { status: 400 });

  const payment = await prisma.payment.findFirst({
    where: { id: paymentId, organizationId: session.user.organizationId },
    include: {
      branch: true,
      allocations: { where: { invoiceId }, include: { invoice: true } },
    },
  });
  const allocation = payment?.allocations[0];
  if (!payment || !allocation) return NextResponse.json({ error: "payment_allocation_not_found" }, { status: 404 });
  if (!canAccessBranch(session, payment.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (allocation.invoice.branchId !== payment.branchId || allocation.invoice.currency !== payment.currency) {
    return NextResponse.json({ error: "financial_context_mismatch" }, { status: 409 });
  }

  const refundNumber = documentNumber("RF", payment.branch.code);

  let result;
  try {
    result = await prisma.$transaction(async tx => {
    const currentPayment = await tx.payment.findFirst({
      where: { id: paymentId, organizationId: session.user.organizationId },
    });
    const currentInvoice = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId: session.user.organizationId },
    });
    const currentAllocation = await tx.paymentAllocation.findUnique({
      where: { paymentId_invoiceId: { paymentId, invoiceId } },
    });
    if (!currentPayment || !currentInvoice || !currentAllocation) {
      return { error: "payment_allocation_not_found", httpStatus: 404 } as const;
    }
    if (currentPayment.branchId !== currentInvoice.branchId || currentPayment.currency !== currentInvoice.currency) {
      return { error: "financial_context_mismatch", httpStatus: 409 } as const;
    }

    const paymentMethod = await resolveSettlementPaymentMethod(tx, {
      organizationId: session.user.organizationId,
      paymentMethodId,
      legacyMethod,
    });
    if (!paymentMethod) return { error: "payment_method_not_available", httpStatus: 409 } as const;
    const referenceError = paymentMethodReferenceError(paymentMethod, reference);
    if (referenceError) return { error: referenceError, httpStatus: 409 } as const;

    const cashierShift = await tx.cashierShift.findFirst({
      where: {
        organizationId: session.user.organizationId,
        branchId: currentPayment.branchId,
        cashierUserId: session.user.id,
        currency: currentPayment.currency,
        status: "OPEN",
      },
    });
    if (!cashierShift) return { error: "cashier_shift_required", httpStatus: 409 } as const;

    const refundedForAllocation = await tx.refund.aggregate({
      where: { paymentId, invoiceId, status: "POSTED" },
      _sum: { amount: true },
    });
    const allocationRefunded = refundedForAllocation._sum.amount ?? new Prisma.Decimal(0);

    const policyError = refundError({
      paymentStatus: currentPayment.status,
      allocated: currentAllocation.amount.toFixed(4),
      refundedForAllocation: allocationRefunded.toFixed(4),
      requested: amount.toFixed(4),
    });
    if (policyError) return { error: policyError, httpStatus: 409 } as const;

    const totalRefundedAfter = currentPayment.refundedAmount.add(amount);
    if (totalRefundedAfter.gt(currentPayment.amount)) {
      return { error: "refund_exceeds_payment", httpStatus: 409 } as const;
    }
    if (amount.gt(currentInvoice.paidAmount)) {
      return { error: "refund_exceeds_invoice_net_payment", httpStatus: 409 } as const;
    }

    const paidAfter = currentInvoice.paidAmount.sub(amount);
    const state = invoiceAdjustmentState({
      total: currentInvoice.total.toFixed(4),
      credited: currentInvoice.creditedAmount.toFixed(4),
      netPaid: paidAfter.toFixed(4),
    });
    if (!state) return { error: "invalid_financial_state", httpStatus: 409 } as const;

    const invoiceUpdated = await tx.invoice.updateMany({
      where: {
        id: currentInvoice.id,
        status: currentInvoice.status,
        creditedAmount: currentInvoice.creditedAmount,
        paidAmount: currentInvoice.paidAmount,
        balanceAmount: currentInvoice.balanceAmount,
      },
      data: {
        paidAmount: paidAfter,
        balanceAmount: new Prisma.Decimal(state.balance),
        status: state.status,
      },
    });
    if (invoiceUpdated.count !== 1) throw new FinancialConflict("invoice_changed");

    const paymentStatus = totalRefundedAfter.eq(currentPayment.amount) ? "REFUNDED" : "POSTED";
    const paymentUpdated = await tx.payment.updateMany({
      where: {
        id: currentPayment.id,
        status: currentPayment.status,
        refundedAmount: currentPayment.refundedAmount,
      },
      data: {
        refundedAmount: totalRefundedAfter,
        status: paymentStatus,
      },
    });
    if (paymentUpdated.count !== 1) throw new FinancialConflict("payment_changed");

    const shiftUpdated = await tx.cashierShift.updateMany({
      where: {
        id: cashierShift.id,
        status: "OPEN",
        activityVersion: cashierShift.activityVersion,
      },
      data: { activityVersion: { increment: 1 } },
    });
    if (shiftUpdated.count !== 1) throw new FinancialConflict("cashier_shift_changed");

    const refund = await tx.refund.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: currentPayment.branchId,
        paymentId: currentPayment.id,
        invoiceId: currentInvoice.id,
        refundNumber,
        currency: currentPayment.currency,
        amount,
        ...paymentMethodSnapshot(paymentMethod),
        reason,
        reference: reference || null,
        paymentAmountSnapshot: currentPayment.amount,
        allocationAmountSnapshot: currentAllocation.amount,
        refundedBeforeSnapshot: currentPayment.refundedAmount,
        invoicePaidBeforeSnapshot: currentInvoice.paidAmount,
        invoiceBalanceBeforeSnapshot: currentInvoice.balanceAmount,
        invoicePaidAfterSnapshot: paidAfter,
        invoiceBalanceAfterSnapshot: new Prisma.Decimal(state.balance),
        processedByUserId: session.user.id,
        cashierShiftId: cashierShift.id,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: currentPayment.branchId,
        actorUserId: session.user.id,
        action: "REFUND_POSTED",
        entityType: "Refund",
        entityId: refund.id,
        newValues: {
          refundNumber,
          paymentId: currentPayment.id,
          invoiceId: currentInvoice.id,
          invoiceNumber: currentInvoice.invoiceNumber,
          currency: currentPayment.currency,
          amount: amount.toFixed(4),
          paymentMethodCode: paymentMethod.code,
          paymentMethodNameEn: paymentMethod.nameEn,
          paymentMethodNameAr: paymentMethod.nameAr,
          baseMethod: paymentMethod.baseMethod,
          reason,
          reference: reference || null,
          cashierShiftId: cashierShift.id,
          shiftNumber: cashierShift.shiftNumber,
          paymentRefundedBefore: currentPayment.refundedAmount.toFixed(4),
          paymentRefundedAfter: totalRefundedAfter.toFixed(4),
          invoicePaidBefore: currentInvoice.paidAmount.toFixed(4),
          invoicePaidAfter: paidAfter.toFixed(4),
          invoiceBalanceBefore: currentInvoice.balanceAmount.toFixed(4),
          invoiceBalanceAfter: state.balance,
          invoiceStatus: state.status,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return {
      status: "ok",
      refundId: refund.id,
      refundNumber,
      invoiceNumber: currentInvoice.invoiceNumber,
      refundedAmount: totalRefundedAfter.toFixed(4),
      paidAmount: paidAfter.toFixed(4),
      balanceAmount: state.balance,
      invoiceStatus: state.status,
      paymentStatus,
    } as const;
    }, { timeout: 30000 });
  } catch (error) {
    if (error instanceof FinancialConflict) {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    throw error;
  }

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  return NextResponse.json(result, { status: 201 });
}
