import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("qc.resolve");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const actionType = ["REPEAT_QC","RECALIBRATE","MAINTENANCE","REPLACE_REAGENT","REPLACE_CONTROL","INVESTIGATE","OTHER"].includes(body.actionType)
    ? body.actionType
    : null;
  const description = text(body.description);
  const resolutionNote = text(body.resolutionNote);
  if (!actionType || !description || !resolutionNote) {
    return NextResponse.json({ error: "action_and_resolution_required" }, { status: 400 });
  }

  const violation = await prisma.qcRuleViolation.findFirst({
    where: {
      id,
      run: { organizationId: session.user.organizationId },
    },
    include: {
      run: { include: { analyzer: true } },
      target: { include: { test: true, component: true } },
    },
  });
  if (!violation) return NextResponse.json({ error: "qc_violation_not_found" }, { status: 404 });
  if (!canAccessBranch(session, violation.run.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (violation.status !== "OPEN") return NextResponse.json({ error: "qc_violation_not_open", status: violation.status }, { status: 409 });

  const resolvedAt = new Date();
  const updated = await prisma.$transaction(async tx => {
    const action = await tx.qcAction.create({
      data: {
        violationId: violation.id,
        actionType,
        description,
        performedByUserId: session.user.id,
      },
    });
    const resolved = await tx.qcRuleViolation.update({
      where: { id: violation.id },
      data: {
        status: "RESOLVED",
        resolvedByUserId: session.user.id,
        resolvedAt,
        resolutionNote,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: violation.run.branchId,
        actorUserId: session.user.id,
        action: "QC_VIOLATION_RESOLVED",
        entityType: "QcRuleViolation",
        entityId: violation.id,
        oldValues: { status: violation.status, ruleCode: violation.ruleCode, severity: violation.severity },
        newValues: {
          status: "RESOLVED",
          resolvedAt,
          actionId: action.id,
          actionType,
          targetId: violation.targetId,
          analyzerId: violation.run.analyzerId,
        },
        reason: resolutionNote,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return resolved;
  });

  return NextResponse.json({ status: "ok", violation: updated });
}
