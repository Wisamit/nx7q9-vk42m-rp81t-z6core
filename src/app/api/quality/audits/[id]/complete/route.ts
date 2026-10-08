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
  let saved;
  try {
    saved = await prisma.$transaction(async tx => {
      // Finding creation, finding closure and audit completion share this parent lock.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM internal_audits WHERE id = ${id}
        AND organization_id = ${session.user.organizationId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("AUDIT_STATE_CHANGED");
      const current = await tx.internalAudit.findUniqueOrThrow({ where: { id } });
      if (["COMPLETED", "CANCELLED"].includes(current.status) ||
          current.updatedAt.getTime() !== audit.updatedAt.getTime()) throw new Error("AUDIT_STATE_CHANGED");
      const remaining = await tx.internalAuditFinding.count({
        where: { auditId: id, status: { not: "CLOSED" } },
      });
      if (remaining > 0) throw new Error("OPEN_AUDIT_FINDINGS");
      const claim = await tx.internalAudit.updateMany({
        where: { id, organizationId: session.user.organizationId, status: current.status, updatedAt: current.updatedAt },
        data: { status: "COMPLETED", completedAt: now, summary },
      });
      if (claim.count !== 1) throw new Error("AUDIT_STATE_CHANGED");
      const updated = await tx.internalAudit.findUniqueOrThrow({ where: { id } });
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
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: reason === "OPEN_AUDIT_FINDINGS" ? "open_audit_findings" : "audit_completion_conflict" }, { status: 409 });
  }
  return NextResponse.json({ status: "ok", audit: saved });
}
