import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { creditNoteError, invoiceAdjustmentState } from "@/lib/billing-adjustments";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function documentNumber(prefix: string, branchCode: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `${prefix}-${branchCode}-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`.slice(0, 50);
}

export async function POST(request: Request) {
  const session = await requirePermission("billing.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const invoiceId = text(body.invoiceId, 36);
  const reason = text(body.reason, 1000);
  const amountText = typeof body.amount === "string" || typeof body.amount === "number" ? String(body.amount) : "";

  if (!invoiceId || !reason || !/^\d+(\.\d{1,4})?$/.test(amountText)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  const amount = new Prisma.Decimal(amountText);
  if (amount.lte(0)) return NextResponse.json({ error: "invalid_amount" }, { status: 400 });

  const invoice = await prisma.invoice.findFirst({
    where: { id: invoiceId, organizationId: session.user.organizationId },
    include: { branch: true },
  });
  if (!invoice) return NextResponse.json({ error: "invoice_not_found" }, { status: 404 });
  if (!canAccessBranch(session, invoice.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const creditNoteNumber = documentNumber("CN", invoice.branch.code);

  const result = await prisma.$transaction(async tx => {
    const current = await tx.invoice.findFirst({
      where: { id: invoiceId, organizationId: session.user.organizationId },
    });
    if (!current) return { error: "invoice_not_found", httpStatus: 404 } as const;
    if (current.branchId !== invoice.branchId) return { error: "invoice_changed", httpStatus: 409 } as const;

    const policyError = creditNoteError({
      invoiceStatus: current.status,
      total: current.total.toFixed(4),
      credited: current.creditedAmount.toFixed(4),
      requested: amount.toFixed(4),
    });
    if (policyError) return { error: policyError, httpStatus: 409 } as const;

    const creditedAfter = current.creditedAmount.add(amount);
    const state = invoiceAdjustmentState({
      total: current.total.toFixed(4),
      credited: creditedAfter.toFixed(4),
      netPaid: current.paidAmount.toFixed(4),
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
        creditedAmount: creditedAfter,
        balanceAmount: new Prisma.Decimal(state.balance),
        status: state.status,
      },
    });
    if (updated.count !== 1) return { error: "invoice_changed", httpStatus: 409 } as const;

    const creditNote = await tx.creditNote.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: current.branchId,
        invoiceId: current.id,
        creditNoteNumber,
        currency: current.currency,
        amount,
        reason,
        invoiceTotalSnapshot: current.total,
        creditedBeforeSnapshot: current.creditedAmount,
        balanceBeforeSnapshot: current.balanceAmount,
        creditedAfterSnapshot: creditedAfter,
        balanceAfterSnapshot: new Prisma.Decimal(state.balance),
        issuedByUserId: session.user.id,
        lines: {
          create: {
            description: `Credit adjustment for invoice ${current.invoiceNumber}`,
            amount,
          },
        },
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: current.branchId,
        actorUserId: session.user.id,
        action: "CREDIT_NOTE_ISSUED",
        entityType: "CreditNote",
        entityId: creditNote.id,
        newValues: {
          creditNoteNumber,
          invoiceId: current.id,
          invoiceNumber: current.invoiceNumber,
          currency: current.currency,
          amount: amount.toFixed(4),
          reason,
          creditedBefore: current.creditedAmount.toFixed(4),
          creditedAfter: creditedAfter.toFixed(4),
          balanceBefore: current.balanceAmount.toFixed(4),
          balanceAfter: state.balance,
          invoiceStatus: state.status,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return {
      status: "ok",
      creditNoteId: creditNote.id,
      creditNoteNumber,
      invoiceNumber: current.invoiceNumber,
      creditedAmount: creditedAfter.toFixed(4),
      balanceAmount: state.balance,
      invoiceStatus: state.status,
    } as const;
  }, { timeout: 30000 });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  return NextResponse.json(result, { status: 201 });
}
