import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("microbiology.enter");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const organismId = text(body?.organismId, 36);
  if (!organismId) return NextResponse.json({ error: "organism_required" }, { status: 400 });

  const [microbiologyCase, organism] = await Promise.all([
    prisma.microbiologyCase.findFirst({ where: { id, organizationId: session.user.organizationId } }),
    prisma.organism.findFirst({ where: { id: organismId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
  ]);
  if (!microbiologyCase) return NextResponse.json({ error: "microbiology_case_not_found" }, { status: 404 });
  if (!organism) return NextResponse.json({ error: "organism_not_found" }, { status: 404 });
  if (!canAccessBranch(session, microbiologyCase.performingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (microbiologyCase.resultId || ["FINAL","CANCELLED"].includes(microbiologyCase.status)) {
    return NextResponse.json({ error: "microbiology_case_locked", status: microbiologyCase.status }, { status: 409 });
  }

  const last = await prisma.microbiologyIsolate.findFirst({
    where: { caseId: id },
    orderBy: { sequenceNumber: "desc" },
    select: { sequenceNumber: true },
  });
  const sequenceNumber = (last?.sequenceNumber || 0) + 1;

  const isolate = await prisma.$transaction(async tx => {
    const created = await tx.microbiologyIsolate.create({
      data: {
        caseId: id,
        organismId,
        organismCodeSnapshot: organism.code,
        organismNameEnSnapshot: organism.nameEn,
        organismNameArSnapshot: organism.nameAr,
        sequenceNumber,
        quantityText: text(body.quantityText, 200) || null,
        colonyNotes: text(body.colonyNotes) || null,
      },
    });
    await tx.microbiologyCase.update({
      where: { id },
      data: { cultureStatus: "GROWTH", status: "IN_PROGRESS" },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: microbiologyCase.performingBranchId,
        actorUserId: session.user.id,
        action: "MICROBIOLOGY_ISOLATE_ADDED",
        entityType: "MicrobiologyIsolate",
        entityId: created.id,
        newValues: { caseId: id, organismId, organismCode: organism.code, sequenceNumber },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", isolate }, { status: 201 });
}
