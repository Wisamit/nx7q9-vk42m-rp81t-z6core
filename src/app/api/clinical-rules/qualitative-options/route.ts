import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { planQualitativeOptionApproval } from "@/lib/qualitative-option-governance";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function code(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
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
  const isCritical = body.isCritical === true;
  const isAbnormal = flag === "ABNORMAL" || body.isAbnormal === true || isCritical;
  const displayOrder = body.displayOrder === "" || body.displayOrder == null ? 0 : Number(body.displayOrder);
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!testId || !optionCode || !valueEn || !qualitativeFlags.has(flag)) {
    return NextResponse.json({ error: "missing_or_invalid_required_fields" }, { status: 400 });
  }
  if (flag === "NORMAL" && isAbnormal) {
    return NextResponse.json({ error: "normal_option_cannot_be_abnormal_or_critical" }, { status: 409 });
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
        approvalStatus: "DRAFT",
        status: "INACTIVE",
        createdByUserId: session.user.id,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "QUALITATIVE_RESULT_OPTION_DRAFT_CREATED",
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
          approvalStatus: created.approvalStatus,
          status: created.status,
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
  const session = await requirePermission("clinical_rules.qualitative_options.approve");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const id = text(body.id, 36);
  const action = text(body.action, 20).toUpperCase();
  const reason = text(body.reason, 1000);
  if (!id || !["APPROVE", "RETIRE"].includes(action)) {
    return NextResponse.json({ error: "invalid_qualitative_option_action" }, { status: 400 });
  }

  const existing = await prisma.qualitativeResultOption.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!existing) return NextResponse.json({ error: "qualitative_option_not_found" }, { status: 404 });

  if (action === "APPROVE") {
    if (existing.approvalStatus !== "DRAFT") {
      return NextResponse.json({ error: "qualitative_option_not_draft", approvalStatus: existing.approvalStatus }, { status: 409 });
    }

    const approved = await prisma.qualitativeResultOption.findMany({
      where: {
        organizationId: session.user.organizationId,
        testId: existing.testId,
        componentId: existing.componentId,
        code: existing.code,
        approvalStatus: "APPROVED",
        status: "ACTIVE",
        id: { not: existing.id },
      },
    });
    const plan = planQualitativeOptionApproval(existing, approved);
    if (plan.conflicts.length > 0) {
      return NextResponse.json({
        error: "approved_qualitative_option_overlap",
        conflictingOptionIds: plan.conflicts,
      }, { status: 409 });
    }

    const approvedAt = new Date();
    const predecessorEffectiveTo = new Date(existing.effectiveFrom.getTime() - 1);

    const option = await prisma.$transaction(async (tx) => {
      for (const predecessorId of plan.predecessorsToClose) {
        const predecessor = approved.find((item) => item.id === predecessorId);
        if (!predecessor) continue;
        await tx.qualitativeResultOption.update({
          where: { id: predecessorId },
          data: { effectiveTo: predecessorEffectiveTo },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: session.activeBranchId,
            actorUserId: session.user.id,
            action: "QUALITATIVE_RESULT_OPTION_SUPERSEDED",
            entityType: "QualitativeResultOption",
            entityId: predecessorId,
            oldValues: { effectiveTo: predecessor.effectiveTo },
            newValues: { effectiveTo: predecessorEffectiveTo, supersededByOptionId: existing.id },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      }

      const updated = await tx.qualitativeResultOption.update({
        where: { id },
        data: {
          approvalStatus: "APPROVED",
          status: "ACTIVE",
          approvedByUserId: session.user.id,
          approvedAt,
          retiredByUserId: null,
          retiredAt: null,
          retirementReason: null,
          deactivatedAt: null,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "QUALITATIVE_RESULT_OPTION_APPROVED",
          entityType: "QualitativeResultOption",
          entityId: id,
          oldValues: { approvalStatus: existing.approvalStatus, status: existing.status },
          newValues: {
            approvalStatus: updated.approvalStatus,
            status: updated.status,
            approvedByUserId: session.user.id,
            approvedAt,
            predecessorsClosed: plan.predecessorsToClose,
            isCritical: updated.isCritical,
            flag: updated.flag,
          },
          reason: reason || null,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return updated;
    });

    return NextResponse.json({ status: "ok", option });
  }

  if (existing.approvalStatus !== "APPROVED") {
    return NextResponse.json({ error: "only_approved_qualitative_option_can_be_retired", approvalStatus: existing.approvalStatus }, { status: 409 });
  }
  if (!reason) {
    return NextResponse.json({ error: "retirement_reason_required" }, { status: 400 });
  }

  const retiredAt = new Date();
  const effectiveTo = existing.effectiveFrom <= retiredAt
    && (existing.effectiveTo === null || existing.effectiveTo > retiredAt)
      ? retiredAt
      : existing.effectiveTo;

  const option = await prisma.$transaction(async (tx) => {
    const updated = await tx.qualitativeResultOption.update({
      where: { id },
      data: {
        approvalStatus: "RETIRED",
        status: "INACTIVE",
        effectiveTo,
        retiredByUserId: session.user.id,
        retiredAt,
        retirementReason: reason,
        deactivatedAt: retiredAt,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "QUALITATIVE_RESULT_OPTION_RETIRED",
        entityType: "QualitativeResultOption",
        entityId: id,
        oldValues: {
          approvalStatus: existing.approvalStatus,
          status: existing.status,
          effectiveTo: existing.effectiveTo,
        },
        newValues: {
          approvalStatus: updated.approvalStatus,
          status: updated.status,
          effectiveTo,
          retiredByUserId: session.user.id,
          retiredAt,
        },
        reason,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return updated;
  });

  return NextResponse.json({ status: "ok", option });
}
