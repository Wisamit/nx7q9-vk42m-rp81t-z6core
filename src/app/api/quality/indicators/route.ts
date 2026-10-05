import { Prisma } from "../../../../../generated/prisma/client";
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

export async function POST(request: Request) {
  const session = await requirePermission("quality.indicators.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId,36) || null;
  const code = text(body.code,80).toUpperCase();
  const nameEn = text(body.nameEn,220);
  const nameAr = text(body.nameAr,220) || null;
  const description = text(body.description,5000) || null;
  const unit = text(body.unit,80) || null;
  const direction = ["LOWER_IS_BETTER","HIGHER_IS_BETTER","TARGET_RANGE"].includes(body.direction) ? body.direction : null;
  const targetMin = body.targetMin === "" || body.targetMin == null ? null : decimal(body.targetMin);
  const targetMax = body.targetMax === "" || body.targetMax == null ? null : decimal(body.targetMax);

  if (!code || !nameEn || !direction) return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  if (body.targetMin != null && body.targetMin !== "" && !targetMin) return NextResponse.json({ error: "invalid_target_min" }, { status: 400 });
  if (body.targetMax != null && body.targetMax !== "" && !targetMax) return NextResponse.json({ error: "invalid_target_max" }, { status: 400 });
  if (direction === "LOWER_IS_BETTER" && !targetMax) return NextResponse.json({ error: "target_max_required" }, { status: 400 });
  if (direction === "HIGHER_IS_BETTER" && !targetMin) return NextResponse.json({ error: "target_min_required" }, { status: 400 });
  if (direction === "TARGET_RANGE" && (!targetMin || !targetMax || targetMin.gt(targetMax))) return NextResponse.json({ error: "valid_target_range_required" }, { status: 400 });

  const scopeKey = branchId ? `BRANCH:${branchId}` : "ORG";
  if (branchId) {
    const branch = await prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } });
    if (!branch || !canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  const duplicate = await prisma.qualityIndicator.findFirst({ where: { organizationId: session.user.organizationId, code, scopeKey } });
  if (duplicate) return NextResponse.json({ error: "quality_indicator_exists" }, { status: 409 });

  const indicator = await prisma.$transaction(async tx => {
    const created = await tx.qualityIndicator.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        scopeKey,
        code,
        nameEn,
        nameAr,
        description,
        unit,
        direction,
        targetMin,
        targetMax,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "QUALITY_INDICATOR_CREATED",
        entityType: "QualityIndicator",
        entityId: created.id,
        newValues: { code, branchId, direction, targetMin: targetMin?.toString() || null, targetMax: targetMax?.toString() || null },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", indicator }, { status: 201 });
}
