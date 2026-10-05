import { NextResponse } from "next/server";
import { Prisma } from "../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeWestgardRules } from "@/lib/qc-westgard";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function decimal(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!/^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) throw new Error("INVALID_DECIMAL");
  return new Prisma.Decimal(raw);
}

export async function POST(request: Request) {
  const session = await requirePermission("qc.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const qcLotId = text(body.qcLotId, 36);
  const analyzerId = text(body.analyzerId, 36);
  const testId = text(body.testId, 36);
  const componentId = text(body.componentId, 36) || null;
  const unitSnapshot = text(body.unitSnapshot, 80) || null;
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;
  const qcValidHours = Number(body.qcValidHours ?? 24);
  const enabledRules = normalizeWestgardRules(body.enabledRules);

  if (!qcLotId || !analyzerId || !testId || Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }
  if (!Number.isInteger(qcValidHours) || qcValidHours < 1 || qcValidHours > 168) {
    return NextResponse.json({ error: "invalid_qc_valid_hours" }, { status: 400 });
  }
  if (enabledRules.length === 0) return NextResponse.json({ error: "at_least_one_qc_rule_required" }, { status: 400 });

  let targetMean: Prisma.Decimal;
  let targetSd: Prisma.Decimal;
  let targetCv: Prisma.Decimal | null;
  try {
    targetMean = decimal(body.targetMean);
    targetSd = decimal(body.targetSd);
    targetCv = body.targetCv === "" || body.targetCv == null ? null : decimal(body.targetCv);
  } catch {
    return NextResponse.json({ error: "invalid_target_value" }, { status: 400 });
  }
  if (targetSd.lte(0) || (targetCv && targetCv.lt(0))) return NextResponse.json({ error: "invalid_target_sd_or_cv" }, { status: 400 });

  const [lot, analyzer, test] = await Promise.all([
    prisma.qcLot.findFirst({ where: { id: qcLotId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.analyzer.findFirst({ where: { id: analyzerId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    prisma.labTest.findFirst({
      where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" },
      include: { components: { where: { status: "ACTIVE" } } },
    }),
  ]);
  if (!lot || !analyzer || !test) return NextResponse.json({ error: "qc_lot_analyzer_or_test_not_found" }, { status: 404 });
  if (!canAccessBranch(session, analyzer.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const component = componentId ? test.components.find(item => item.id === componentId) : null;
  if (test.components.length > 0 && !component) return NextResponse.json({ error: "component_required_for_multi_component_test" }, { status: 409 });
  if (test.components.length === 0 && componentId) return NextResponse.json({ error: "component_not_valid_for_simple_test" }, { status: 409 });

  const mapping = await prisma.analyzerTestMapping.findFirst({
    where: {
      analyzerId,
      testId,
      componentId,
      status: "ACTIVE",
      effectiveFrom: { lte: effectiveFrom },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
    },
    select: { id: true },
  });
  if (!mapping) return NextResponse.json({ error: "active_analyzer_mapping_required_for_qc_target" }, { status: 409 });

  const overlapping = await prisma.qcTarget.findFirst({
    where: {
      organizationId: session.user.organizationId,
      qcLotId,
      analyzerId,
      testId,
      componentId,
      status: "ACTIVE",
      effectiveFrom: { lte: effectiveTo || new Date("9999-12-31") },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }],
    },
    select: { id: true },
  });
  if (overlapping) return NextResponse.json({ error: "overlapping_qc_target" }, { status: 409 });

  const target = await prisma.$transaction(async tx => {
    const created = await tx.qcTarget.create({
      data: {
        organizationId: session.user.organizationId,
        qcLotId,
        analyzerId,
        testId,
        componentId,
        targetMean,
        targetSd,
        targetCv,
        unitSnapshot,
        enabledRules,
        qcValidHours,
        effectiveFrom,
        effectiveTo,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: analyzer.branchId,
        actorUserId: session.user.id,
        action: "QC_TARGET_CREATED",
        entityType: "QcTarget",
        entityId: created.id,
        newValues: {
          qcLotId,
          analyzerId,
          testId,
          componentId,
          targetMean: targetMean.toString(),
          targetSd: targetSd.toString(),
          targetCv: targetCv?.toString() || null,
          unitSnapshot,
          enabledRules,
          qcValidHours,
          effectiveFrom,
          effectiveTo,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", target }, { status: 201 });
}
