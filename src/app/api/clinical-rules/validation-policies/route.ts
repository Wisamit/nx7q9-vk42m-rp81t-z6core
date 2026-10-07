import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function code(value: unknown) {
  return text(value, 80).toUpperCase().replace(/[^A-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
}

function overlaps(aStart: Date, aEnd: Date | null, bStart: Date, bEnd: Date | null) {
  return (aEnd === null || bStart <= aEnd) && (bEnd === null || aStart <= bEnd);
}

export async function POST(request: Request) {
  const session = await requirePermission("clinical_rules.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const scope = text(body.scope, 30);
  const policyCode = code(body.code);
  const nameEn = text(body.nameEn, 200);
  const nameAr = text(body.nameAr, 200) || null;
  const branchId = text(body.branchId, 36) || null;
  const departmentId = text(body.departmentId, 36) || null;
  const testId = text(body.testId, 36) || null;
  const requiresMedicalValidation = body.requiresMedicalValidation === true;
  const allowSameReviewer = requiresMedicalValidation && body.allowSameReviewer === true;
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!["ORGANIZATION","DEPARTMENT","TEST"].includes(scope) || !policyCode || !nameEn) {
    return NextResponse.json({ error: "invalid_required_fields" }, { status: 400 });
  }
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom))) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }
  if (scope === "ORGANIZATION" && (departmentId || testId)) {
    return NextResponse.json({ error: "organization_scope_cannot_target_department_or_test" }, { status: 400 });
  }
  if (scope === "DEPARTMENT" && (!departmentId || testId)) {
    return NextResponse.json({ error: "department_scope_requires_department_only" }, { status: 400 });
  }
  if (scope === "TEST" && (!testId || departmentId)) {
    return NextResponse.json({ error: "test_scope_requires_test_only" }, { status: 400 });
  }

  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!branch) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
  }

  if (departmentId) {
    const department = await prisma.department.findFirst({
      where: { id: departmentId, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, branchId: true },
    });
    if (!department) return NextResponse.json({ error: "department_not_found" }, { status: 404 });
    if (branchId && department.branchId && department.branchId !== branchId) {
      return NextResponse.json({ error: "department_branch_mismatch" }, { status: 409 });
    }
  }

  if (testId) {
    const test = await prisma.labTest.findFirst({
      where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" },
    });
    if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
  }

  const existing = await prisma.resultValidationPolicy.findMany({
    where: {
      organizationId: session.user.organizationId,
      scope: scope as "ORGANIZATION" | "DEPARTMENT" | "TEST",
      branchId,
      departmentId,
      testId,
      status: "ACTIVE",
    },
  });

  if (existing.some(policy => overlaps(policy.effectiveFrom, policy.effectiveTo, effectiveFrom, effectiveTo))) {
    return NextResponse.json({ error: "validation_policy_effective_range_overlap" }, { status: 409 });
  }

  try {
    const policy = await prisma.$transaction(async tx => {
      const created = await tx.resultValidationPolicy.create({
        data: {
          organizationId: session.user.organizationId,
          scope: scope as "ORGANIZATION" | "DEPARTMENT" | "TEST",
          branchId,
          departmentId,
          testId,
          code: policyCode,
          nameEn,
          nameAr,
          requiresMedicalValidation,
          allowSameReviewer,
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
          action: "RESULT_VALIDATION_POLICY_CREATED",
          entityType: "ResultValidationPolicy",
          entityId: created.id,
          newValues: {
            code: policyCode,
            scope,
            branchId,
            departmentId,
            testId,
            requiresMedicalValidation,
            allowSameReviewer,
            effectiveFrom,
            effectiveTo,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return created;
    });

    return NextResponse.json({ status: "ok", policy }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "validation_policy_create_failed" }, { status: 409 });
  }
}

export async function PATCH(request: Request) {
  const session = await requirePermission("clinical_rules.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const id = text(body.id, 36);
  const status = body.status === "ACTIVE" ? "ACTIVE" : body.status === "INACTIVE" ? "INACTIVE" : null;
  if (!id || !status) return NextResponse.json({ error: "invalid_status_change" }, { status: 400 });

  const existing = await prisma.resultValidationPolicy.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!existing) return NextResponse.json({ error: "validation_policy_not_found" }, { status: 404 });
  if (existing.status === status) return NextResponse.json({ status: "ok", policy: existing });

  if (status === "ACTIVE") {
    const siblings = await prisma.resultValidationPolicy.findMany({
      where: {
        organizationId: session.user.organizationId,
        scope: existing.scope,
        branchId: existing.branchId,
        departmentId: existing.departmentId,
        testId: existing.testId,
        status: "ACTIVE",
        id: { not: existing.id },
      },
    });
    if (siblings.some(policy => overlaps(policy.effectiveFrom, policy.effectiveTo, existing.effectiveFrom, existing.effectiveTo))) {
      return NextResponse.json({ error: "validation_policy_effective_range_overlap" }, { status: 409 });
    }
  }

  const policy = await prisma.$transaction(async tx => {
    const updated = await tx.resultValidationPolicy.update({
      where: { id },
      data: { status, deactivatedAt: status === "INACTIVE" ? new Date() : null },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: status === "ACTIVE" ? "RESULT_VALIDATION_POLICY_REACTIVATED" : "RESULT_VALIDATION_POLICY_DEACTIVATED",
        entityType: "ResultValidationPolicy",
        entityId: id,
        oldValues: { status: existing.status },
        newValues: { status },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return updated;
  });

  return NextResponse.json({ status: "ok", policy });
}
