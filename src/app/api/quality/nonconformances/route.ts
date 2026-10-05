import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function caseNumber(prefix: string) {
  const day = new Date().toISOString().slice(0,10).replaceAll("-","");
  return `${prefix}-${day}-${randomUUID().slice(0,8).toUpperCase()}`;
}

export async function POST(request: Request) {
  const session = await requirePermission("quality.nonconformance.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36) || null;
  const title = text(body.title, 255);
  const description = text(body.description);
  const category = text(body.category, 100);
  const severity = ["MINOR","MAJOR","CRITICAL"].includes(body.severity) ? body.severity : null;
  const ownerUserId = text(body.ownerUserId, 36) || null;
  const sourceEntityType = text(body.sourceEntityType, 100) || null;
  const sourceEntityId = text(body.sourceEntityId, 100) || null;
  const immediateAction = text(body.immediateAction) || null;
  const occurredAt = body.occurredAt ? new Date(String(body.occurredAt)) : null;

  if (!title || !description || !category || !severity || (occurredAt && Number.isNaN(occurredAt.getTime()))) {
    return NextResponse.json({ error: "missing_or_invalid_fields" }, { status: 400 });
  }

  const [branchRecord, owner] = await Promise.all([
    branchId ? prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
    ownerUserId ? prisma.user.findFirst({ where: { id: ownerUserId, organizationId: session.user.organizationId, status: "ACTIVE" } }) : Promise.resolve(null),
  ]);
  if (branchId && (!branchRecord || !canAccessBranch(session, branchId))) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (ownerUserId && !owner) return NextResponse.json({ error: "owner_not_found" }, { status: 404 });

  const record = await prisma.$transaction(async tx => {
    const created = await tx.nonconformance.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        caseNumber: caseNumber("NC"),
        title,
        description,
        category,
        severity,
        occurredAt,
        sourceEntityType,
        sourceEntityId,
        immediateAction,
        reportedByUserId: session.user.id,
        ownerUserId,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "NONCONFORMANCE_CREATED",
        entityType: "Nonconformance",
        entityId: created.id,
        newValues: { caseNumber: created.caseNumber, severity, category, ownerUserId, sourceEntityType, sourceEntityId },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", nonconformance: record }, { status: 201 });
}
