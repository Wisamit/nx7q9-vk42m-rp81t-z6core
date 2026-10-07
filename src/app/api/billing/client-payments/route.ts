import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { invoiceAdjustmentState } from "@/lib/billing-adjustments";
import { clientPaymentAllocationError } from "@/lib/client-accounting";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

class ClientPaymentConflict extends Error {
  constructor(public readonly code: "invoice_changed" | "cashier_shift_changed") {
    super(code);
  }
}

export async function POST(request: Request) {
  const session = await requirePermission("billing.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const clientId = text(body.clientId, 36);
  const branchId = text(body.branchId, 36);
  const currency = text(body.currency, 3).toUpperCase();
  const reference = text(body.reference, 150);
  const method = ["CASH","CARD","BANK_TRANSFER","ONLINE","OTHER"].includes(String(body.method))
    ? String(body.method) as "CASH" | "CARD" | "BANK_TRANSFER" | "ONLINE" | "OTHER"
    : null;
  const amountText = typeof body.amount === "string" || typeof body.amount === "number" ? String(body.amount) : "";
  const rawAllocations = Array.isArray(body.allocations) ? body.allocations : [];
  const allocations = rawAllocations
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    .map(item => ({
      invoiceId: text(item.invoiceId, 36),
      amount: typeof item.amount === "string" || typeof item.amount === "number" ? String(item.amount) : "",
    }))
    .filter(item => item.invoiceId);

  if (!clientId || !branchId || !/^[A-Z]{3}$/.test(currency) || !method || !/^\d+(\.\d{1,4})?$/.test(amountText) || allocations.length === 0) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }
  if (new Set(allocations.map(item => item.invoiceId)).size !== allocations.length) {
    return NextResponse.json({ error: "duplicate_invoice_allocation" }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const [client, invoices] = await Promise.all([
    prisma.client.findFirst({ where: { id: clientId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.invoice.findMany({
      where: {
        id: { in: allocations.map(item => item.invoiceId) },
        organizationId: session.user.organizationId,
        clientId,
        branchId,
        currency,
        status: { in: ["ISSUED", "PARTIALLY_PAID"] },
      },
    }),
  ]);
  if (!client) return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  if (invoices.length !== allocations.length) return NextResponse.json({ error: "invalid_invoice_allocation_scope" }, { status: 409 });

  const invoiceMap = new Map(invoices.map(invoice => [invoice.id, invoice]));
  const policyError = clientPaymentAllocationError({
    paymentAmount: amountText,
    allocations: allocations.map(allocation => ({
      amount: allocation.amount,
      invoiceBalance: invoiceMap.get(allocation.invoiceId)!.balanceAmount.toFixed(4),
    })),
  });
  if (policyError) return NextResponse.json({ error: policyError }, { status: 409 });

  const paymentAmount = new Prisma.Decimal(amountText);

  let result;
  try {
    result = await prisma.$transaction(async tx => {
      const currentInvoices = await tx.invoice.findMany({
        where: {
          id: { in: allocations.map(item => item.invoiceId) },
          organizationId: session.user.organizationId,
          clientId,
          branchId,
          currency,
          status: { in: ["ISSUED", "PARTIALLY_PAID"] },
        },
      });
      if (currentInvoices.length !== allocations.length) {
        return { error: "invoice_allocation_changed", httpStatus: 409 } as const;
      }

      const currentMap = new Map(currentInvoices.map(invoice => [invoice.id, invoice]));
      const currentPolicyError = clientPaymentAllocationError({
        paymentAmount: amountText,
        allocations: allocations.map(allocation => ({
          amount: allocation.amount,
          invoiceBalance: currentMap.get(allocation.invoiceId)!.balanceAmount.toFixed(4),
        })),
      });
      if (currentPolicyError) return { error: currentPolicyError, httpStatus: 409 } as const;

      const cashierShift = await tx.cashierShift.findFirst({
        where: {
          organizationId: session.user.organizationId,
          branchId,
          cashierUserId: session.user.id,
          currency,
          status: "OPEN",
        },
      });
      if (!cashierShift) return { error: "cashier_shift_required", httpStatus: 409 } as const;

      for (const allocation of allocations) {
        const invoice = currentMap.get(allocation.invoiceId)!;
        const allocationAmount = new Prisma.Decimal(allocation.amount);
        const paidAfter = invoice.paidAmount.add(allocationAmount);
        const state = invoiceAdjustmentState({
          total: invoice.total.toFixed(4),
          credited: invoice.creditedAmount.toFixed(4),
          netPaid: paidAfter.toFixed(4),
        });
        if (!state) return { error: "invalid_financial_state", httpStatus: 409 } as const;

        const updated = await tx.invoice.updateMany({
          where: {
            id: invoice.id,
            status: invoice.status,
            creditedAmount: invoice.creditedAmount,
            paidAmount: invoice.paidAmount,
            balanceAmount: invoice.balanceAmount,
          },
          data: {
            paidAmount: paidAfter,
            balanceAmount: new Prisma.Decimal(state.balance),
            status: state.status,
          },
        });
        if (updated.count !== 1) throw new ClientPaymentConflict("invoice_changed");
      }

      const shiftUpdated = await tx.cashierShift.updateMany({
        where: {
          id: cashierShift.id,
          status: "OPEN",
          activityVersion: cashierShift.activityVersion,
        },
        data: { activityVersion: { increment: 1 } },
      });
      if (shiftUpdated.count !== 1) throw new ClientPaymentConflict("cashier_shift_changed");

      const payment = await tx.payment.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          amount: paymentAmount,
          currency,
          method,
          reference: reference || null,
          cashierUserId: session.user.id,
          cashierShiftId: cashierShift.id,
        },
      });
      await tx.paymentAllocation.createMany({
        data: allocations.map(allocation => ({
          paymentId: payment.id,
          invoiceId: allocation.invoiceId,
          amount: allocation.amount,
        })),
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "CLIENT_ACCOUNT_PAYMENT_POSTED",
          entityType: "Payment",
          entityId: payment.id,
          newValues: {
            clientId,
            clientCode: client.code,
            amount: paymentAmount.toFixed(4),
            currency,
            method,
            reference: reference || null,
            cashierShiftId: cashierShift.id,
            shiftNumber: cashierShift.shiftNumber,
            allocations: allocations.map(allocation => ({
              invoiceId: allocation.invoiceId,
              invoiceNumber: currentMap.get(allocation.invoiceId)!.invoiceNumber,
              amount: new Prisma.Decimal(allocation.amount).toFixed(4),
            })),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return { paymentId: payment.id, allocationCount: allocations.length } as const;
    }, { timeout: 30000 });
  } catch (error) {
    if (error instanceof ClientPaymentConflict) {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    throw error;
  }

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.httpStatus });
  return NextResponse.json({
    status: "ok",
    paymentId: result.paymentId,
    amount: paymentAmount.toFixed(4),
    allocationCount: result.allocationCount,
  }, { status: 201 });
}
