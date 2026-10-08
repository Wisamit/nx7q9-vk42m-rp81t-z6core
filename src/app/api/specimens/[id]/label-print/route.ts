import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { specimenLabelPrintError, specimenLabelSize } from "@/lib/code128";
import { prisma } from "@/lib/db";
import { specimenRequirementSnapshotFromDetails } from "@/lib/specimen-requirement-engine";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.collect");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const reason = text(body?.reason, 500);
  const labelSize = specimenLabelSize(text(body?.labelSize, 20));

  const specimen = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      order: true,
      events: { where: { eventType: "CREATED" }, orderBy: { occurredAt: "asc" } },
    },
  });
  if (!specimen) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });

  const branchId = specimen.currentBranchId && canAccessBranch(session, specimen.currentBranchId)
    ? specimen.currentBranchId
    : canAccessBranch(session, specimen.order.orderingBranchId) ? specimen.order.orderingBranchId : null;
  if (!branchId) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const requirement = specimen.events
    .map(event => specimenRequirementSnapshotFromDetails(event.details))
    .find(Boolean) || null;
  const outcome = await prisma.$transaction(async tx => {
    // Serialize print decisions on the specimen so simultaneous requests cannot
    // both be mistaken for the first print (and bypass the reprint reason).
    const lock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM specimens
      WHERE id = ${specimen.id} AND organization_id = ${session.user.organizationId}
      FOR UPDATE
    `;
    if (lock.length !== 1) return { error: "specimen_not_found", priorPrintCount: 0 };
    const priorPrintCount = await tx.auditEvent.count({
      where: {
        organizationId: session.user.organizationId,
        action: "SPECIMEN_LABEL_PRINTED",
        entityType: "Specimen",
        entityId: specimen.id,
      },
    });
    const policyError = specimenLabelPrintError({
      status: specimen.status,
      requirementsFinalized: Boolean(requirement),
      priorPrintCount,
      reason,
    });
    if (policyError) return { error: policyError, priorPrintCount };

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        actorUserId: session.user.id,
        action: "SPECIMEN_LABEL_PRINTED",
        entityType: "Specimen",
        entityId: specimen.id,
        reason: priorPrintCount > 0 ? reason : null,
        newValues: {
          barcode: specimen.barcode,
          labelSize,
          specimenStatus: specimen.status,
          printSequence: priorPrintCount + 1,
          reprint: priorPrintCount > 0,
          requirementsFinalized: Boolean(requirement),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return { priorPrintCount, printSequence: priorPrintCount + 1, reprint: priorPrintCount > 0 };
  });
  if ("error" in outcome) {
    return NextResponse.json(
      { error: outcome.error, priorPrintCount: outcome.priorPrintCount },
      { status: outcome.error === "reprint_reason_required" ? 400 : 409 },
    );
  }
  return NextResponse.json({
    status: "ok",
    printSequence: outcome.printSequence,
    reprint: outcome.reprint,
  });
}
