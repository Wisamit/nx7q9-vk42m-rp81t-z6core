import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { cashierShiftActiveKey } from "@/lib/cashier-shift-policy";
import { money4ToMinor } from "@/lib/billing-adjustments";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function shiftNumber(branchCode: string) {
  const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
  return `CS-${branchCode}-${stamp}-${randomUUID().slice(0, 8).toUpperCase()}`.slice(0, 50);
}

export async function POST(request: Request) {
  const session = await requirePermission("billing.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36);
  const currency = text(body.currency, 3).toUpperCase();
  const openingCashText = typeof body.openingCash === "string" || typeof body.openingCash === "number"
    ? String(body.openingCash)
    : "";
  const openingCash = money4ToMinor(openingCashText);
  if (!branchId || !/^[A-Z]{3}$/.test(currency) || openingCash === null) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const branchRow = await prisma.branch.findFirst({
    where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" },
    select: { id: true, code: true },
  });
  if (!branchRow) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });

  const activeKey = cashierShiftActiveKey(branchId, session.user.id, currency);
  const number = shiftNumber(branchRow.code);

  try {
    const shift = await prisma.$transaction(async tx => {
      const created = await tx.cashierShift.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          cashierUserId: session.user.id,
          shiftNumber: number,
          currency,
          openingCash: openingCashText,
          activeKey,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "CASHIER_SHIFT_OPENED",
          entityType: "CashierShift",
          entityId: created.id,
          newValues: {
            shiftNumber: number,
            currency,
            openingCash: created.openingCash.toFixed(4),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({
      status: "ok",
      shiftId: shift.id,
      shiftNumber: shift.shiftNumber,
      currency: shift.currency,
      openingCash: shift.openingCash.toFixed(4),
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "active_shift_already_exists" }, { status: 409 });
  }
}
