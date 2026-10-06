import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { invoiceAdjustmentState } from "@/lib/billing-adjustments";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 150) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("billing.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const invoiceId = text(body.invoiceId, 36);
  if (body.method === "CREDIT_ACCOUNT") return NextResponse.json({ error: "credit_account_is_not_settlement" }, { status: 400 });
  const method = ["CASH","CARD","BANK_TRANSFER","ONLINE","OTHER"].includes(body.method) ? body.method : null;
  const reference = text(body.reference, 150);
  const amountText = typeof body.amount === "string" || typeof body.amount === "number" ? String(body.amount) : "";

  if (!invoiceId || !method || !/^\d+(\.\d{1,4})?$/.test(amountText)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  const amount = new Prisma.Decimal(amountText);
  if (amount.lte(0)) return NextResponse.json({ error: "invalid_amount" }, { status: 400 });

  const invoice = await prisma.invoice.findFirst({
    where: {
      id: invoiceId,
      organizationId: session.user.organizationId,
      status: { in: ["ISSUED", "PARTIALLY_PAID"] },
    },
  });
  if (!invoice) return NextResponse.json({ error: "invoice_not_payable" }, { status: 404 });
  if (!canAccessBranch(session, invoice.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const result = await prisma.$transaction(async tx => {
    const current = await tx.invoice.findFirst({
      where: {
        id: invoiceId,
        organizationId: session.user.organizationId,
        status: { in: ["ISSUED", "PARTIALLY_PAID"] },
      },
    });
    if (!current) return { error: "invoice_not_payable", httpStatus: 409 } as const;

    const balance = new Prisma.Decimal(current.balanceAmount);
    if (amount.gt(balance)) {
      return { error: "amount_exceeds_balance", httpStatus: 409, balance: balance.toString() } as const;
    }

    const newPaid = new Prisma.Decimal(current.paidAmount).add(amount);
    const state = invoiceAdjustmentState({
      total: current.total.toFixed(4),
      credited: current.creditedAmount.toFixed(4),
      netPaid: newPaid.toFixed(4),
    });
    if (!state) return { error: "invalid_financial_state", httpStatus: 409 } as const;

    const updated = await tx.invoice.updateMany({
      where: {
        id: current.id,
        status: current.status,
        creditedAmount: current.creditedAmount,
        paidAmount: current.paidAmount,
        balanceAmount: current.balanceAmount,
      },
      data: {
        paidAmount: newPaid,
        balanceAmount: new Prisma.Decimal(state.balance),
        status: state.status,
      },
    });
    if (updated.count !== 1) return { error: "invoice_changed", httpStatus: 409 } as const;

    const payment = await tx.payment.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: current.branchId,
        amount,
        currency: current.currency,
        method,
        reference: reference || null,
        cashierUserId: session.user.id,
      },
    });

    await tx.paymentAllocation.create({
      data: {
        paymentId: payment.id,
        invoiceId: current.id,
        amount,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: current.branchId,
        actorUserId: session.user.id,
        action: "PAYMENT_POSTED",
        entityType: "Payment",
        entityId: payment.id,
        newValues: {
          invoiceId: current.id,
          invoiceNumber: current.invoiceNumber,
          amount: amount.toString(),
          currency: current.currency,
          method,
          reference: reference || null,
          creditedAmount: current.creditedAmount.toString(),
          invoiceBalance: state.balance,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return {
      status: "ok",
      paymentId: payment.id,
      invoiceNumber: current.invoiceNumber,
      paidAmount: newPaid.toString(),
      balanceAmount: state.balance,
      invoiceStatus: state.status,
    } as const;
  }, { timeout: 30000 });

  if ("error" in result) {
    return NextResponse.json(
      { error: result.error, ...("balance" in result ? { balance: result.balance } : {}) },
      { status: result.httpStatus },
    );
  }
  return NextResponse.json(result, { status: 201 });
}
