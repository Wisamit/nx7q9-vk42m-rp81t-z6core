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
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const audit = await prisma.internalAudit.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { findings: { select: { id: true } } },
  });
  if (!audit) return NextResponse.json({ error: "internal_audit_not_found" }, { status: 404 });
  if (audit.branchId && !canAccessBranch(session, audit.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (["COMPLETED","CANCELLED"].includes(audit.status)) return NextResponse.json({ error: "audit_locked" }, { status: 409 });

  const severity = ["OBSERVATION","MINOR","MAJOR","CRITICAL"].includes(body.severity) ? body.severity : null;
  const description = text(body.description);
  const requirementRef = text(body.requirementRef,255) || null;
  const ownerUserId = text(body.ownerUserId,36) || null;
  const dueDate = body.dueDate ? new Date(String(body.dueDate)) : null;
  const capaId = text(body.capaId,36) || null;

  if (!severity || !description || (dueDate && Number.isNaN(dueDate.getTime()))) return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  const [owner, capa] = await Promise.all([
    ownerUserId ? prisma.user.findFirst({ where: { id: ownerUserId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
    capaId ? prisma.capa.findFirst({ where: { id: capaId, organizationId: session.user.organizationId } }) : Promise.resolve(null),
  ]);
  if (ownerUserId && !owner) return NextResponse.json({ error: "owner_not_found" }, { status: 404 });
  if (capaId && !capa) return NextResponse.json({ error: "capa_not_found" }, { status: 404 });

  const finding = await prisma.$transaction(async tx => {
    if (audit.status === "PLANNED") await tx.internalAudit.update({ where: { id }, data: { status: "IN_PROGRESS", startedAt: new Date() } });
    const created = await tx.internalAuditFinding.create({
      data: {
        auditId: id,
        findingNumber: `F-${String(audit.findings.length + 1).padStart(3,"0")}`,
        severity,
        description,
        requirementRef,
        ownerUserId,
        dueDate,
        capaId,
        status: severity === "OBSERVATION" ? "OPEN" : "ACTION_REQUIRED",
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: audit.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "INTERNAL_AUDIT_FINDING_CREATED",
        entityType: "InternalAuditFinding",
        entityId: created.id,
        newValues: { auditId: id, findingNumber: created.findingNumber, severity, ownerUserId, dueDate, capaId },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", finding }, { status: 201 });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("quality.audits.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const findingId = text(body?.findingId,36);
  const closureNote = text(body?.closureNote);
  if (!findingId || !closureNote) return NextResponse.json({ error: "closure_note_required" }, { status: 400 });

  const finding = await prisma.internalAuditFinding.findFirst({
    where: { id: findingId, auditId: id, audit: { organizationId: session.user.organizationId } },
    include: { audit: true },
  });
  if (!finding) return NextResponse.json({ error: "finding_not_found" }, { status: 404 });
  if (finding.audit.branchId && !canAccessBranch(session, finding.audit.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (finding.status === "CLOSED") return NextResponse.json({ error: "finding_already_closed" }, { status: 409 });
  if (finding.severity === "CRITICAL" && !finding.capaId) return NextResponse.json({ error: "critical_finding_requires_capa" }, { status: 409 });

  const saved = await prisma.$transaction(async tx => {
    const updated = await tx.internalAuditFinding.update({
      where: { id: finding.id },
      data: { status: "CLOSED", closedByUserId: session.user.id, closedAt: new Date(), closureNote },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: finding.audit.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "INTERNAL_AUDIT_FINDING_CLOSED",
        entityType: "InternalAuditFinding",
        entityId: finding.id,
        oldValues: { status: finding.status },
        newValues: { status: "CLOSED", closedAt: updated.closedAt },
        reason: closureNote,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return updated;
  });
  return NextResponse.json({ status: "ok", finding: saved });
}
