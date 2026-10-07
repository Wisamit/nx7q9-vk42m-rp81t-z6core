import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 100) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("clinical_rules.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const testId = text(body.testId, 36);
  const branchId = text(body.branchId, 36) || null;
  const acknowledgementMinutes = Number(body.acknowledgementMinutes);
  const escalationIntervalMinutes = Number(body.escalationIntervalMinutes);
  const maxEscalationLevel = Number(body.maxEscalationLevel);
  const requireReadBack = body.requireReadBack !== false;
  const effectiveFrom = new Date(String(body.effectiveFrom || ""));
  const effectiveTo = body.effectiveTo ? new Date(String(body.effectiveTo)) : null;

  if (!testId || !Number.isInteger(acknowledgementMinutes) || acknowledgementMinutes < 1 || acknowledgementMinutes > 1440) {
    return NextResponse.json({ error: "invalid_acknowledgement_minutes" }, { status: 400 });
  }
  if (!Number.isInteger(escalationIntervalMinutes) || escalationIntervalMinutes < 1 || escalationIntervalMinutes > 1440) {
    return NextResponse.json({ error: "invalid_escalation_interval" }, { status: 400 });
  }
  if (!Number.isInteger(maxEscalationLevel) || maxEscalationLevel < 1 || maxEscalationLevel > 10) {
    return NextResponse.json({ error: "invalid_max_escalation_level" }, { status: 400 });
  }
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && (Number.isNaN(effectiveTo.getTime()) || effectiveTo < effectiveFrom))) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const [test, branchRecord] = await Promise.all([
    prisma.labTest.findFirst({ where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    branchId ? prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
  ]);
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
  if (branchId && !branchRecord) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });

  const policy = await prisma.$transaction(async tx => {
    const created = await tx.criticalEscalationPolicy.create({
      data: {
        organizationId: session.user.organizationId,
        testId,
        branchId,
        acknowledgementMinutes,
        escalationIntervalMinutes,
        maxEscalationLevel,
        requireReadBack,
        effectiveFrom,
        effectiveTo,
        status: "INACTIVE",
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "CRITICAL_ESCALATION_POLICY_DRAFT_CREATED",
        entityType: "CriticalEscalationPolicy",
        entityId: created.id,
        newValues: { testId, branchId, acknowledgementMinutes, escalationIntervalMinutes, maxEscalationLevel, requireReadBack, effectiveFrom, effectiveTo },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", policy }, { status: 201 });
}
