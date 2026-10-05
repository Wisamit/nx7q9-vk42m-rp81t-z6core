import { Prisma } from "../../../../../../generated/prisma/client";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function decimal(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) return null;
  try { return new Prisma.Decimal(raw); } catch { return null; }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("quality.indicators.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const indicator = await prisma.qualityIndicator.findFirst({
    where: { id, organizationId: session.user.organizationId, status: "ACTIVE" },
  });
  if (!indicator) return NextResponse.json({ error: "quality_indicator_not_found" }, { status: 404 });
  if (indicator.branchId && !canAccessBranch(session, indicator.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const periodStart = new Date(String(body.periodStart || ""));
  const periodEnd = new Date(String(body.periodEnd || ""));
  const value = decimal(body.value);
  const numerator = body.numerator === "" || body.numerator == null ? null : decimal(body.numerator);
  const denominator = body.denominator === "" || body.denominator == null ? null : decimal(body.denominator);
  const notes = text(body.notes) || null;

  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd < periodStart || !value) {
    return NextResponse.json({ error: "invalid_period_or_value" }, { status: 400 });
  }
  if ((body.numerator != null && body.numerator !== "" && !numerator) || (body.denominator != null && body.denominator !== "" && !denominator)) {
    return NextResponse.json({ error: "invalid_numerator_or_denominator" }, { status: 400 });
  }
  if (denominator && denominator.lte(0)) return NextResponse.json({ error: "denominator_must_be_positive" }, { status: 400 });

  const measurement = await prisma.$transaction(async tx => {
    const created = await tx.qualityIndicatorMeasurement.create({
      data: { indicatorId: id, periodStart, periodEnd, value, numerator, denominator, notes, recordedByUserId: session.user.id },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: indicator.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "QUALITY_INDICATOR_MEASURED",
        entityType: "QualityIndicatorMeasurement",
        entityId: created.id,
        newValues: { indicatorId: id, periodStart, periodEnd, value: value.toString(), numerator: numerator?.toString() || null, denominator: denominator?.toString() || null },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });
  return NextResponse.json({ status: "ok", measurement }, { status: 201 });
}
