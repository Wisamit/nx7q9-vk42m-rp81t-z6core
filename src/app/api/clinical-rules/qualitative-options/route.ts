import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function code(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

function overlaps(aStart: Date, aEnd: Date | null, bStart: Date, bEnd: Date | null) {
  return (aEnd === null || bStart <= aEnd) && (bEnd === null || aStart <= bEnd);
}

const qualitativeFlags = new Set(["NORMAL", "ABNORMAL", "POSITIVE", "NEGATIVE", "UNKNOWN"]);

export async function POST(request: Request) {
  const session = await requirePermission("clinical_rules.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const testId = text(body.testId, 36);
  const componentId = text(body.componentId, 36) || null;
  const optionCode = code(text(body.code, 80) || text(body.valueEn, 80));
  const valueEn = text(body.valueEn, 500);
  const valueAr = text(body.valueAr, 500) || null;
  const flag = text(body.flag, 30) || "UNKNOWN";
  const isAbnormal = body.isAbnormal === true;
  const isCritical = body.isCritical === true;
  const displayOrder = body.displayOrder === "" || body.displayOrder == null ? 0 : Number(body.displayOrder);
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!testId || !optionCode || !valueEn || !qualitativeFlags.has(flag)) {
    return NextResponse.json({ error: "missing_or_invalid_required_fields" }, { status: 400 });
  }
  if (!Number.isInteger(displayOrder) || displayOrder < 0 || displayOrder > 10000) {
    return NextResponse.json({ error: "invalid_display_order" }, { status: 400 });
  }
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom))) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const test = await prisma.labTest.findFirst({
    where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" },
    include: { components: { where: { status: "ACTIVE" } } },
  });
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });

  if (test.components.length === 0) {
    if (test.resultType !== "QUALITATIVE") {
      return NextResponse.json({ error: "simple_test_must_be_qualitative" }, { status: 409 });
    }
    if (componentId) {
      return NextResponse.json({ error: "simple_test_cannot_target_component" }, { status: 409 });
    }
  } else {
    if (!componentId) {
      return NextResponse.json({ error: "component_required_for_panel_test" }, { status: 400 });
    }
    const component = test.components.find((item) => item.id === componentId);
    if (!component) return NextResponse.json({ error: "component_not_found" }, { status: 404 });
    if (component.resultType !== "QUALITATIVE") {
      return NextResponse.json({ error: "component_must_be_qualitative" }, { status: 409 });
    }
  }

  const existing = await prisma.qualitativeResultOption.findMany({
    where: {
      organizationId: session.user.organizationId,
      testId,
      componentId,
      code: optionCode,
      status: "ACTIVE",
    },
    select: { effectiveFrom: true, effectiveTo: true },
  });
  if (existing.some((item) => overlaps(effectiveFrom, effectiveTo, item.effectiveFrom, item.effectiveTo))) {
    return NextResponse.json({ error: "overlapping_qualitative_option_code" }, { status: 409 });
  }

  const option = await prisma.$transaction(async (tx) => {
    const created = await tx.qualitativeResultOption.create({
      data: {
        organizationId: session.user.organizationId,
        testId,
        componentId,
        code: optionCode,
        valueEn,
        valueAr,
        flag: flag as "NORMAL" | "ABNORMAL" | "POSITIVE" | "NEGATIVE" | "UNKNOWN",
        isAbnormal,
        isCritical,
        displayOrder,
        effectiveFrom,
        effectiveTo,
        createdByUserId: session.user.id,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "QUALITATIVE_RESULT_OPTION_CREATED",
        entityType: "QualitativeResultOption",
        entityId: created.id,
        newValues: {
          testId,
          componentId,
          code: optionCode,
          valueEn,
          valueAr,
          flag,
          isAbnormal,
          isCritical,
          displayOrder,
          effectiveFrom,
          effectiveTo,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", option }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await requirePermission("clinical_rules.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const id = text(body.id, 36);
  const status = body.status === "ACTIVE" ? "ACTIVE" : body.status === "INACTIVE" ? "INACTIVE" : null;
  if (!id || !status) return NextResponse.json({ error: "invalid_status_change" }, { status: 400 });

  const existing = await prisma.qualitativeResultOption.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!existing) return NextResponse.json({ error: "qualitative_option_not_found" }, { status: 404 });
  if (existing.status === status) return NextResponse.json({ status: "ok", option: existing });

  if (status === "ACTIVE") {
    const conflicts = await prisma.qualitativeResultOption.findMany({
      where: {
        organizationId: session.user.organizationId,
        testId: existing.testId,
        componentId: existing.componentId,
        code: existing.code,
        status: "ACTIVE",
        id: { not: existing.id },
      },
      select: { effectiveFrom: true, effectiveTo: true },
    });
    if (conflicts.some((item) => overlaps(existing.effectiveFrom, existing.effectiveTo, item.effectiveFrom, item.effectiveTo))) {
      return NextResponse.json({ error: "overlapping_qualitative_option_code" }, { status: 409 });
    }
  }

  const option = await prisma.$transaction(async (tx) => {
    const updated = await tx.qualitativeResultOption.update({
      where: { id },
      data: {
        status,
        deactivatedAt: status === "INACTIVE" ? new Date() : null,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: status === "INACTIVE" ? "QUALITATIVE_RESULT_OPTION_DEACTIVATED" : "QUALITATIVE_RESULT_OPTION_REACTIVATED",
        entityType: "QualitativeResultOption",
        entityId: id,
        oldValues: { status: existing.status },
        newValues: { status },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return updated;
  });

  return NextResponse.json({ status: "ok", option });
}
