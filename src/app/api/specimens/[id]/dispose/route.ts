import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.reject");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim().slice(0, 1000) : "";
  if (!reason) return NextResponse.json({ error: "disposal_reason_required" }, { status: 400 });

  const specimen = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      childSpecimens: {
        where: { parentRelationType: "ALIQUOT", status: { notIn: ["REJECTED", "DISPOSED"] } },
        select: { id: true },
      },
    },
  });
  if (!specimen) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });
  if (!specimen.currentBranchId || !canAccessBranch(session, specimen.currentBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  // Conservative initial policy: rejected specimens only. Retained clinical
  // material needs a separate retention/authorization policy before disposal.
  if (specimen.status !== "REJECTED") {
    return NextResponse.json({ error: "only_rejected_specimens_disposable" }, { status: 409 });
  }
  if (specimen.childSpecimens.length) {
    return NextResponse.json({ error: "active_child_aliquots_require_resolution" }, { status: 409 });
  }

  const result = await prisma.$transaction(async tx => {
    const changed = await tx.specimen.updateMany({
      where: {
        id: specimen.id,
        organizationId: session.user.organizationId,
        status: "REJECTED",
        currentBranchId: specimen.currentBranchId,
        preanalyticalVersion: specimen.preanalyticalVersion,
      },
      data: { status: "DISPOSED", storageLocation: null, storageLocationId: null, preanalyticalVersion: { increment: 1 } },
    });
    if (changed.count !== 1) return false;
    const remainingChildren = await tx.specimen.count({
      where: {
        parentSpecimenId: specimen.id,
        parentRelationType: "ALIQUOT",
        status: { notIn: ["REJECTED", "DISPOSED"] },
      },
    });
    if (remainingChildren) throw new Error("ACTIVE_CHILD_ALIQUOTS");

    await tx.specimenEvent.create({
      data: {
        specimenId: specimen.id,
        eventType: "DISPOSED",
        branchId: specimen.currentBranchId!,
        actorUserId: session.user.id,
        fromStatus: "REJECTED",
        toStatus: "DISPOSED",
        details: { reason, previousStorageLocation: specimen.storageLocation, previousStorageLocationId: specimen.storageLocationId },
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: specimen.organizationId,
        branchId: specimen.currentBranchId,
        actorUserId: session.user.id,
        action: "SPECIMEN_DISPOSED",
        entityType: "Specimen",
        entityId: specimen.id,
        reason,
        oldValues: { status: "REJECTED", storageLocation: specimen.storageLocation, storageLocationId: specimen.storageLocationId },
        newValues: { status: "DISPOSED", barcode: specimen.barcode, storageLocation: null, storageLocationId: null },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return true;
  }).catch(error => {
    if (error instanceof Error && error.message === "ACTIVE_CHILD_ALIQUOTS") return false;
    throw error;
  });
  if (!result) return NextResponse.json({ error: "specimen_state_changed_or_active_children" }, { status: 409 });
  return NextResponse.json({ status: "ok", specimenStatus: "DISPOSED" });
}
