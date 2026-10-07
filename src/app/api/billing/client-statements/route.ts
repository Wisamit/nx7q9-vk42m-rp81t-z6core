import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { buildClientStatementLedger, localDateStartUtc, nextDateString, type ClientLedgerEvent } from "@/lib/client-accounting";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function statementNumber(clientCode: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `ST-${clientCode}-${stamp}-${randomUUID().slice(0, 6).toUpperCase()}`.slice(0, 50);
}

export async function POST(request: Request) {
  const session = await requirePermission("billing.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const clientId = text(body.clientId, 36);
  const branchId = text(body.branchId, 36) || null;
  const currency = text(body.currency, 3).toUpperCase();
  const periodStart = text(body.periodStart, 10);
  const periodEnd = text(body.periodEnd, 10);
  const nextEnd = nextDateString(periodEnd);
  if (!clientId || !/^[A-Z]{3}$/.test(currency) || !periodStart || !periodEnd || !nextEnd || periodStart > periodEnd) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  const [client, organization, activeBranches] = await Promise.all([
    prisma.client.findFirst({
      where: { id: clientId, organizationId: session.user.organizationId, status: "ACTIVE" },
    }),
    prisma.organization.findUnique({
      where: { id: session.user.organizationId },
      select: { defaultTimezone: true },
    }),
    prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true, nameAr: true, timezone: true },
    }),
  ]);
  if (!client || !organization) return NextResponse.json({ error: "client_not_found" }, { status: 404 });

  const accessibleIds = new Set(session.user.branchScopes.filter(scope => scope.branch.status === "ACTIVE").map(scope => scope.branchId));
  let branch = null as (typeof activeBranches)[number] | null;
  let branchIds: string[];
  let timezone: string;

  if (branchId) {
    branch = activeBranches.find(item => item.id === branchId) || null;
    if (!branch) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
    if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
    branchIds = [branchId];
    timezone = branch.timezone;
  } else {
    if (activeBranches.some(item => !accessibleIds.has(item.id))) {
      return NextResponse.json({ error: "organization_scope_incomplete" }, { status: 403 });
    }
    branchIds = activeBranches.map(item => item.id);
    timezone = organization.defaultTimezone;
  }

  const startUtc = localDateStartUtc(periodStart, timezone);
  const endExclusiveUtc = localDateStartUtc(nextEnd, timezone);
  if (!startUtc || !endExclusiveUtc || startUtc >= endExclusiveUtc) {
    return NextResponse.json({ error: "invalid_period_timezone" }, { status: 400 });
  }

  const [invoices, creditNotes, allocations, refunds] = await Promise.all([
    prisma.invoice.findMany({
      where: {
        organizationId: session.user.organizationId,
        clientId,
        branchId: { in: branchIds },
        currency,
        status: { not: "VOID" },
        issuedAt: { lt: endExclusiveUtc },
      },
      include: { branch: true },
    }),
    prisma.creditNote.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
        currency,
        status: "ISSUED",
        issuedAt: { lt: endExclusiveUtc },
        invoice: { clientId },
      },
      include: { branch: true, invoice: true },
    }),
    prisma.paymentAllocation.findMany({
      where: {
        invoice: {
          organizationId: session.user.organizationId,
          clientId,
          branchId: { in: branchIds },
          currency,
        },
        payment: {
          organizationId: session.user.organizationId,
          status: { not: "VOIDED" },
          receivedAt: { lt: endExclusiveUtc },
        },
      },
      include: {
        invoice: { include: { branch: true } },
        payment: true,
      },
    }),
    prisma.refund.findMany({
      where: {
        organizationId: session.user.organizationId,
        branchId: { in: branchIds },
        currency,
        status: "POSTED",
        processedAt: { lt: endExclusiveUtc },
        invoice: { clientId },
      },
      include: { branch: true, invoice: true },
    }),
  ]);

  const events: ClientLedgerEvent[] = [
    ...invoices.map(invoice => ({
      sourceId: invoice.id,
      sourceNumber: invoice.invoiceNumber,
      branchId: invoice.branchId,
      branchCode: invoice.branch.code,
      occurredAt: invoice.issuedAt,
      lineType: "INVOICE" as const,
      description: `Invoice ${invoice.invoiceNumber}`,
      amount: invoice.total.toFixed(4),
    })),
    ...creditNotes.map(note => ({
      sourceId: note.id,
      sourceNumber: note.creditNoteNumber,
      branchId: note.branchId,
      branchCode: note.branch.code,
      occurredAt: note.issuedAt,
      lineType: "CREDIT_NOTE" as const,
      description: `Credit note ${note.creditNoteNumber} for ${note.invoice.invoiceNumber}`,
      amount: note.amount.toFixed(4),
    })),
    ...allocations.map(allocation => ({
      sourceId: allocation.paymentId,
      sourceNumber: allocation.payment.reference || `PAY-${allocation.paymentId.slice(0, 8).toUpperCase()}`,
      branchId: allocation.invoice.branchId,
      branchCode: allocation.invoice.branch.code,
      occurredAt: allocation.payment.receivedAt,
      lineType: "PAYMENT" as const,
      description: `Payment allocated to ${allocation.invoice.invoiceNumber}`,
      amount: allocation.amount.toFixed(4),
    })),
    ...refunds.map(refund => ({
      sourceId: refund.id,
      sourceNumber: refund.refundNumber,
      branchId: refund.branchId,
      branchCode: refund.branch.code,
      occurredAt: refund.processedAt,
      lineType: "REFUND" as const,
      description: `Refund ${refund.refundNumber} for ${refund.invoice.invoiceNumber}`,
      amount: refund.amount.toFixed(4),
    })),
  ];

  const ledger = buildClientStatementLedger({
    openingEvents: events.filter(event => event.occurredAt < startUtc),
    periodEvents: events.filter(event => event.occurredAt >= startUtc && event.occurredAt < endExclusiveUtc),
  });
  if (!ledger) return NextResponse.json({ error: "invalid_ledger_state" }, { status: 409 });

  const number = statementNumber(client.code);
  const statement = await prisma.$transaction(async tx => {
    const created = await tx.clientAccountStatement.create({
      data: {
        organizationId: session.user.organizationId,
        clientId,
        branchId,
        statementNumber: number,
        currency,
        periodStart: new Date(periodStart + "T00:00:00.000Z"),
        periodEnd: new Date(periodEnd + "T00:00:00.000Z"),
        timezoneSnapshot: timezone,
        clientCodeSnapshot: client.code,
        clientNameEnSnapshot: client.nameEn,
        clientNameArSnapshot: client.nameAr,
        paymentTermsDaysSnapshot: client.paymentTermsDays,
        branchCodeSnapshot: branch?.code || null,
        branchNameEnSnapshot: branch?.nameEn || null,
        branchNameArSnapshot: branch?.nameAr || null,
        openingBalance: ledger.openingBalance,
        invoiceCharges: ledger.invoiceCharges,
        creditNotes: ledger.creditNotes,
        payments: ledger.payments,
        refunds: ledger.refunds,
        closingBalance: ledger.closingBalance,
        generatedByUserId: session.user.id,
        lines: {
          create: ledger.lines.map(line => ({
            lineType: line.lineType,
            sourceId: line.sourceId,
            sourceNumber: line.sourceNumber,
            branchIdSnapshot: line.branchId,
            branchCodeSnapshot: line.branchCode,
            occurredAt: line.occurredAt,
            description: line.description,
            debitAmount: line.debitAmount,
            creditAmount: line.creditAmount,
            runningBalance: line.runningBalance,
          })),
        },
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        actorUserId: session.user.id,
        action: "CLIENT_ACCOUNT_STATEMENT_ISSUED",
        entityType: "ClientAccountStatement",
        entityId: created.id,
        newValues: {
          statementNumber: number,
          clientId,
          clientCode: client.code,
          branchId,
          currency,
          periodStart,
          periodEnd,
          timezone,
          openingBalance: ledger.openingBalance,
          invoiceCharges: ledger.invoiceCharges,
          creditNotes: ledger.creditNotes,
          payments: ledger.payments,
          refunds: ledger.refunds,
          closingBalance: ledger.closingBalance,
          lineCount: ledger.lines.length,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  }, { timeout: 30000 });

  return NextResponse.json({
    status: "ok",
    statementId: statement.id,
    statementNumber: statement.statementNumber,
    openingBalance: statement.openingBalance.toFixed(4),
    closingBalance: statement.closingBalance.toFixed(4),
  }, { status: 201 });
}
