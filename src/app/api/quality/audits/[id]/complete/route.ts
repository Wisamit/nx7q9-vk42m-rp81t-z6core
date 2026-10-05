import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("quality.audits.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const summary = text(body?.summary);
  if (!summary) return NextResponse.json({ error: "audit_summary_required" }, { status: 400 });

  const audit = await prisma.internalAudit.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { findings: true },
  });
  if (!audit) return NextResponse.json({ error: "internal_audit_not_found" }, { status: 404 });
  if (audit.branchId && !canAccessBranch(session, audit.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (["COMPLETED","CANCELLED"].includes(audit.status)) return NextResponse.json({ error: "audit_locked" }, { status: 409 });
  const openFindings = audit.findings.filter(finding => finding.status !== "CLOSED");
  if (openFindings.length > 0) return NextResponse.json({ error: "open_audit_findings", count: openFindings.length }, { status: 409 });

  const now = new Date();
  const saved = await prisma.$transaction(async tx => {
    const updated = await tx.internalAudit.update({ where: { id }, data: { status: "COMPLETED", completedAt: now, summary } });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: audit.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "INTERNAL_AUDIT_COMPLETED",
        entityType: "InternalAudit",
        entityId: id,
        oldValues: { status: audit.status },
        newValues: { status: "COMPLETED", completedAt: now },
        reason: summary,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return updated;
  });
  return NextResponse.json({ status: "ok", audit: saved });
}
