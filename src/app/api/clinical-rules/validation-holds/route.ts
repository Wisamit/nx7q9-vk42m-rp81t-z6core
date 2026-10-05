import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("clinical_rules.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const testId = text(body.testId, 36);
  const branchId = text(body.branchId, 36) || null;
  const condition = ["ALWAYS","RESULT_SOURCE","ANY_ABNORMAL","ANY_CRITICAL","DELTA_EXCEEDED"].includes(body.condition)
    ? body.condition
    : null;
  const resultSource = ["MANUAL","ANALYZER","IMPORT","CALCULATED"].includes(body.resultSource)
    ? body.resultSource
    : null;
  const severity = body.severity === "WARNING" ? "WARNING" : "BLOCK";
  const reasonEn = text(body.reasonEn, 500);
  const reasonAr = text(body.reasonAr, 500) || null;
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!testId || !condition || !reasonEn || Number.isNaN(effectiveFrom.getTime())) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (condition === "RESULT_SOURCE" && !resultSource) {
    return NextResponse.json({ error: "result_source_required" }, { status: 400 });
  }
  if (condition !== "RESULT_SOURCE" && resultSource) {
    return NextResponse.json({ error: "result_source_only_valid_for_source_condition" }, { status: 400 });
  }
  if (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const [test, branchRecord] = await Promise.all([
    prisma.labTest.findFirst({ where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    branchId
      ? prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } })
      : Promise.resolve(null),
  ]);
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
  if (branchId && !branchRecord) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });

  const rule = await prisma.$transaction(async tx => {
    const created = await tx.validationHoldRule.create({
      data: {
        organizationId: session.user.organizationId,
        testId,
        branchId,
        condition,
        resultSource: condition === "RESULT_SOURCE" ? resultSource : null,
        severity,
        reasonEn,
        reasonAr,
        effectiveFrom,
        effectiveTo,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "VALIDATION_HOLD_RULE_CREATED",
        entityType: "ValidationHoldRule",
        entityId: created.id,
        newValues: { testId, branchId, condition, resultSource, severity, reasonEn, reasonAr, effectiveFrom, effectiveTo },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", rule }, { status: 201 });
}
