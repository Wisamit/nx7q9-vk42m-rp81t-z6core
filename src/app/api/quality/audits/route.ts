import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function auditNumber() {
  const day = new Date().toISOString().slice(0,10).replaceAll("-","");
  return `IA-${day}-${randomUUID().slice(0,8).toUpperCase()}`;
}

export async function POST(request: Request) {
  const session = await requirePermission("quality.audits.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId,36) || null;
  const title = text(body.title,255);
  const scope = text(body.scope);
  const scheduledAt = new Date(String(body.scheduledAt || ""));
  const leadAuditorUserId = text(body.leadAuditorUserId,36);

  if (!title || !scope || !leadAuditorUserId || Number.isNaN(scheduledAt.getTime())) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }

  const [branchRecord, auditor] = await Promise.all([
    branchId ? prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
    prisma.user.findFirst({ where: { id: leadAuditorUserId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
  ]);
  if (branchId && (!branchRecord || !canAccessBranch(session, branchId))) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (!auditor) return NextResponse.json({ error: "lead_auditor_not_found" }, { status: 404 });

  const audit = await prisma.$transaction(async tx => {
    const created = await tx.internalAudit.create({
      data: { organizationId: session.user.organizationId, branchId, auditNumber: auditNumber(), title, scope, scheduledAt, leadAuditorUserId },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "INTERNAL_AUDIT_CREATED",
        entityType: "InternalAudit",
        entityId: created.id,
        newValues: { auditNumber: created.auditNumber, branchId, scheduledAt, leadAuditorUserId },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", audit }, { status: 201 });
}
