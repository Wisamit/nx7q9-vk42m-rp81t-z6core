import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
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
  const method = ["CASH","CARD","BANK_TRANSFER","ONLINE","CREDIT_ACCOUNT","OTHER"].includes(body.method) ? body.method : null;
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

  const balance = new Prisma.Decimal(invoice.balanceAmount);
  if (amount.gt(balance)) return NextResponse.json({ error: "amount_exceeds_balance", balance: balance.toString() }, { status: 409 });

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: invoice.branchId,
        amount,
        currency: invoice.currency,
        method,
        reference: reference || null,
        cashierUserId: session.user.id,
      },
    });

    await tx.paymentAllocation.create({
      data: {
        paymentId: payment.id,
        invoiceId: invoice.id,
        amount,
      },
    });

    const newPaid = new Prisma.Decimal(invoice.paidAmount).add(amount);
    const newBalance = new Prisma.Decimal(invoice.total).sub(newPaid);
    const newStatus = newBalance.eq(0) ? "PAID" : "PARTIALLY_PAID";

    const updatedInvoice = await tx.invoice.update({
      where: { id: invoice.id },
      data: {
        paidAmount: newPaid,
        balanceAmount: newBalance,
        status: newStatus,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: invoice.branchId,
        actorUserId: session.user.id,
        action: "PAYMENT_POSTED",
        entityType: "Payment",
        entityId: payment.id,
        newValues: {
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          amount: amount.toString(),
          currency: invoice.currency,
          method,
          reference: reference || null,
          invoiceBalance: newBalance.toString(),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return { payment, invoice: updatedInvoice };
  }, { timeout: 30000 });

  return NextResponse.json({
    status: "ok",
    paymentId: result.payment.id,
    invoiceNumber: result.invoice.invoiceNumber,
    paidAmount: result.invoice.paidAmount.toString(),
    balanceAmount: result.invoice.balanceAmount.toString(),
    invoiceStatus: result.invoice.status,
  }, { status: 201 });
}
