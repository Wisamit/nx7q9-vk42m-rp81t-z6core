import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { creditNoteError, invoiceAdjustmentState } from "@/lib/billing-adjustments";
import { prisma } from "@/lib/db";
import { taxCreditReversal } from "@/lib/tax-policy";
import { consumeStaffStepUp, StaffStepUpError } from "@/lib/staff-step-up";

class CreditNoteStateChanged extends Error {}

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
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const invoiceId = text(body.invoiceId, 36);
  const reason = text(body.reason, 1000);
  const amountText = typeof body.amount === "string" || typeof body.amount === "number" ? String(body.amount) : "";

  if (!invoiceId || !reason || !/^\d+(\.\d{1,4})?$/.test(amountText)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  const rawLines: unknown[] = Array.isArray(body.lines) ? body.lines : [];
  const lines = rawLines.flatMap((value: unknown) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const item = value as Record<string, unknown>;
    const invoiceLineId = text(item.invoiceLineId, 36);
    const itemAmount = typeof item.amount === "string" || typeof item.amount === "number" ? String(item.amount) : "";
    return invoiceLineId && /^\d+(?:\.\d{1,4})?$/.test(itemAmount)
      ? [{ invoiceLineId, amount: itemAmount }] : [];
  });
  if (rawLines.length !== lines.length || new Set(lines.map(item => item.invoiceLineId)).size !== lines.length) {
    return NextResponse.json({ error: "invalid_credit_lines" }, { status: 400 });
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

    let creditTaxTotal = new Prisma.Decimal(0);
    const creditLines: Array<{ invoiceLineId: string; description: string; amount: string; taxAmountSnapshot: string }> = [];
    if (current.taxTotal.gt(0)) {
      if (lines.length === 0) return { error: "credit_lines_required_for_tax_invoice", httpStatus: 409 } as const;
      const invoiceLines = await tx.invoiceLine.findMany({
        where: { invoiceId: current.id, id: { in: lines.map(item => item.invoiceLineId) } },
        select: { id: true, description: true, lineTotal: true, taxAmount: true },
      });
      if (invoiceLines.length !== lines.length) return { error: "invalid_credit_lines", httpStatus: 409 } as const;
      const originalById = new Map(invoiceLines.map(item => [item.id, item]));
      const previous = await tx.creditNoteLine.findMany({
        where: {
          invoiceLineId: { in: lines.map(item => item.invoiceLineId) },
          creditNote: { invoiceId: current.id, status: "ISSUED" },
        },
        select: { invoiceLineId: true, amount: true, taxAmountSnapshot: true },
      });
      const previousById = new Map<string, { gross: Prisma.Decimal; tax: Prisma.Decimal }>();
      for (const item of previous) {
        if (!item.invoiceLineId) continue;
        const existing = previousById.get(item.invoiceLineId) || { gross: new Prisma.Decimal(0), tax: new Prisma.Decimal(0) };
        previousById.set(item.invoiceLineId, {
          gross: existing.gross.add(item.amount),
          tax: existing.tax.add(item.taxAmountSnapshot),
        });
      }
      let allocatedGross = new Prisma.Decimal(0);
      for (const item of lines) {
        const original = originalById.get(item.invoiceLineId)!;
        const before = previousById.get(item.invoiceLineId) || { gross: new Prisma.Decimal(0), tax: new Prisma.Decimal(0) };
        const reversed = taxCreditReversal({
          originalGross: original.lineTotal.toFixed(4),
          originalTax: original.taxAmount.toFixed(4),
          previouslyCreditedGross: before.gross.toFixed(4),
          previouslyCreditedTax: before.tax.toFixed(4),
          additionalGross: item.amount,
        });
        if (!reversed) return { error: "credit_exceeds_invoice_line", httpStatus: 409 } as const;
        creditLines.push({
          invoiceLineId: item.invoiceLineId,
          description: original.description,
          amount: item.amount,
          taxAmountSnapshot: reversed.taxAmount,
        });
        allocatedGross = allocatedGross.add(item.amount);
        creditTaxTotal = creditTaxTotal.add(reversed.taxAmount);
      }
      if (!allocatedGross.eq(amount)) return { error: "credit_allocation_total_mismatch", httpStatus: 409 } as const;
    }

    const creditedAfter = current.creditedAmount.add(amount);
    const state = invoiceAdjustmentState({
      total: current.total.toFixed(4),
      credited: creditedAfter.toFixed(4),
      netPaid: current.paidAmount.toFixed(4),
    });
    if (!state) return { error: "invalid_financial_state", httpStatus: 409 } as const;

    const stepUp = await consumeStaffStepUp(tx, {
      token: request.headers.get("x-staff-step-up-token"),
      action: "CREDIT_NOTE_ISSUE",
      resourceKey: [invoiceId, amountText].join(":"),
      sessionId: session.id,
      userId: session.user.id,
      organizationId: session.user.organizationId,
      branchId: current.branchId,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
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
    if (updated.count !== 1) throw new CreditNoteStateChanged();

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
        taxTotalSnapshot: creditTaxTotal,
        creditedBeforeSnapshot: current.creditedAmount,
        balanceBeforeSnapshot: current.balanceAmount,
        creditedAfterSnapshot: creditedAfter,
        balanceAfterSnapshot: new Prisma.Decimal(state.balance),
        issuedByUserId: session.user.id,
        lines: {
          create: creditLines.length > 0
            ? creditLines.map(line => ({
                invoiceLineId: line.invoiceLineId,
                description: line.description,
                amount: line.amount,
                taxAmountSnapshot: line.taxAmountSnapshot,
              }))
            : [{ description: `Credit adjustment for invoice ${current.invoiceNumber}`, amount }],
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
          taxReversed: creditTaxTotal.toFixed(4),
          reason,
          creditedBefore: current.creditedAmount.toFixed(4),
          creditedAfter: creditedAfter.toFixed(4),
          balanceBefore: current.balanceAmount.toFixed(4),
          balanceAfter: state.balance,
          invoiceStatus: state.status,
          stepUpGrantId: stepUp.grantId,
          stepUpProofMethod: stepUp.proofMethod,
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
      taxReversed: creditTaxTotal.toFixed(4),
      balanceAmount: state.balance,
      invoiceStatus: state.status,
    } as const;
  }, { timeout: 30000 }).catch((error: unknown) => {
    if (error instanceof StaffStepUpError) {
      return { error: error.code, httpStatus: error.statusCode } as const;
    }
    if (error instanceof CreditNoteStateChanged) {
      return { error: "invoice_changed", httpStatus: 409 } as const;
    }
    throw error;
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  return NextResponse.json(result, { status: 201 });
}
