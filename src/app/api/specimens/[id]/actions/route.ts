import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { specimenActionError } from "@/lib/clinical-safety";
import {
  specimenCollectionVolumeError,
  specimenRequirementSnapshotFromDetails,
} from "@/lib/specimen-requirement-engine";
import { specimenRejectionLineageError } from "@/lib/specimen-volume-policy";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null) as {
    action?: "COLLECT" | "RECEIVE" | "REJECT";
    branchId?: string;
    volume?: string | number;
    volumeUnit?: string;
    notes?: string;
    rejectionReasonCode?: string;
    rejectionReasonText?: string;
  } | null;

  if (!body?.action) return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  const permission =
    body.action === "COLLECT" ? "specimens.collect" :
    body.action === "RECEIVE" ? "specimens.receive" :
    "specimens.reject";

  const session = await requirePermission(permission);
  const ctx = await requestContext();
  const branchId = text(body.branchId, 36) || session.activeBranchId;
  if (!branchId || !canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const specimen = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      order: true,
      orderItems: { include: { orderItem: true } },
      specimenType: true,
      container: true,
      parentSpecimen: { select: { id: true, barcode: true, status: true } },
      childSpecimens: { select: { id: true, barcode: true, status: true, parentRelationType: true } },
      events: { where: { eventType: "CREATED" }, orderBy: { occurredAt: "asc" } },
    },
  });
  if (!specimen) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });

  const requirementSnapshot = specimen.events
    .map(event => specimenRequirementSnapshotFromDetails(event.details))
    .find(Boolean) || null;

  const lifecycleError = specimenActionError({
    status: specimen.status,
    action: body.action,
    specimenTypeConfigured: Boolean(specimen.specimenTypeId),
  });
  if (lifecycleError) {
    return NextResponse.json({ error: lifecycleError, status: specimen.status }, { status: 409 });
  }

  if (body.action === "COLLECT") {
    if (!requirementSnapshot) {
      return NextResponse.json({ error: "specimen_requirements_not_finalized" }, { status: 409 });
    }
    if (!requirementSnapshot.configurationComplete) {
      return NextResponse.json({ error: "specimen_requirement_configuration_incomplete" }, { status: 409 });
    }

    const volumeText = body.volume == null || body.volume === "" ? "" : String(body.volume);
    const volume = volumeText ? Number(volumeText) : null;
    if (volume !== null && (!Number.isFinite(volume) || volume < 0)) {
      return NextResponse.json({ error: "invalid_volume" }, { status: 400 });
    }
    const volumeUnit = text(body.volumeUnit, 30) || null;
    const volumeError = specimenCollectionVolumeError({
      requiredVolume: requirementSnapshot.requiredVolume,
      requiredVolumeUnit: requirementSnapshot.requiredVolumeUnit,
      collectedVolume: volumeText || null,
      collectedVolumeUnit: volumeUnit,
    });
    if (volumeError) {
      return NextResponse.json({
        error: volumeError,
        requiredVolume: requirementSnapshot.requiredVolume,
        requiredVolumeUnit: requirementSnapshot.requiredVolumeUnit,
      }, { status: volumeError === "invalid_volume" ? 400 : 409 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.specimen.updateMany({
        where: { id: specimen.id, status: "PLANNED" },
        data: {
          status: "COLLECTED",
          collectionBranchId: branchId,
          currentBranchId: branchId,
          collectedByUserId: session.user.id,
          collectedAt: new Date(),
          volume: volume === null ? null : volume.toFixed(3),
          volumeUnit,
          remainingVolume: volume === null ? null : volume.toFixed(3),
          remainingVolumeUnit: volume === null ? null : volumeUnit,
          notes: text(body.notes, 5000) || null,
        },
      });
      if (changed.count !== 1) throw new Error("SPECIMEN_STATE_CHANGED");
      const updated = await tx.specimen.findUniqueOrThrow({ where: { id: specimen.id } });

      const linkedIds = specimen.orderItems.map((link) => link.orderItemId);
      if (linkedIds.length) {
        await tx.orderItem.updateMany({
          where: { id: { in: linkedIds }, status: "ORDERED" },
          data: { status: "COLLECTED" },
        });
      }

      const remaining = await tx.orderItem.count({ where: { orderId: specimen.orderId, status: "ORDERED" } });
      if (remaining === 0 && specimen.order.status === "REGISTERED") {
        await tx.labOrder.update({ where: { id: specimen.orderId }, data: { status: "COLLECTED" } });
        await tx.orderStatusHistory.create({
          data: {
            orderId: specimen.orderId,
            fromStatus: "REGISTERED",
            toStatus: "COLLECTED",
            reason: "All currently required specimen plans collected",
            changedByUserId: session.user.id,
          },
        });
      }

      await tx.specimenEvent.create({
        data: {
          specimenId: specimen.id,
          eventType: "COLLECTED",
          branchId,
          actorUserId: session.user.id,
          fromStatus: "PLANNED",
          toStatus: "COLLECTED",
          details: {
            volume: volume === null ? null : volume.toFixed(3),
            volumeUnit,
            requiredVolume: requirementSnapshot.requiredVolume,
            requiredVolumeUnit: requirementSnapshot.requiredVolumeUnit,
            volumeRequirementMet: true,
            notes: text(body.notes, 5000) || null,
          },
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "SPECIMEN_COLLECTED",
          entityType: "Specimen",
          entityId: specimen.id,
          newValues: {
            barcode: specimen.barcode,
            status: "COLLECTED",
            collectionBranchId: branchId,
            requiredVolume: requirementSnapshot.requiredVolume,
            requiredVolumeUnit: requirementSnapshot.requiredVolumeUnit,
            collectedVolume: volume === null ? null : volume.toFixed(3),
            collectedVolumeUnit: volumeUnit,
            remainingVolume: volume === null ? null : volume.toFixed(3),
            remainingVolumeUnit: volume === null ? null : volumeUnit,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return updated;
    });

    return NextResponse.json({ status: "ok", specimen: result });
  }

  if (body.action === "RECEIVE") {
    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.specimen.updateMany({
        where: { id: specimen.id, status: specimen.status },
        data: {
          status: "RECEIVED",
          currentBranchId: branchId,
          receivedByUserId: session.user.id,
          receivedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new Error("SPECIMEN_STATE_CHANGED");
      const updated = await tx.specimen.findUniqueOrThrow({ where: { id: specimen.id } });

      await tx.specimenEvent.create({
        data: {
          specimenId: specimen.id,
          eventType: "RECEIVED",
          branchId,
          actorUserId: session.user.id,
          fromStatus: specimen.status,
          toStatus: "RECEIVED",
          details: { previousBranchId: specimen.currentBranchId },
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "SPECIMEN_RECEIVED",
          entityType: "Specimen",
          entityId: specimen.id,
          newValues: { barcode: specimen.barcode, status: "RECEIVED", currentBranchId: branchId },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return updated;
    });

    return NextResponse.json({ status: "ok", specimen: result });
  }

  const reasonCode = text(body.rejectionReasonCode, 80);
  const reasonText = text(body.rejectionReasonText, 500);
  if (!reasonCode || !reasonText) return NextResponse.json({ error: "rejection_reason_required" }, { status: 400 });

  const lineageError = specimenRejectionLineageError(specimen.childSpecimens);
  if (lineageError) {
    return NextResponse.json({
      error: lineageError,
      childBarcodes: specimen.childSpecimens
        .filter(child => child.parentRelationType === "ALIQUOT" && !["REJECTED","DISPOSED"].includes(child.status))
        .map(child => child.barcode),
    }, { status: 409 });
  }

  if (specimen.parentRelationType === "ALIQUOT" && specimen.parentSpecimenId) {
    const result = await prisma.$transaction(async tx => {
      const rejected = await tx.specimen.updateMany({
        where: { id: specimen.id, status: specimen.status },
        data: {
          status: "REJECTED",
          currentBranchId: branchId,
          rejectedByUserId: session.user.id,
          rejectedAt: new Date(),
          rejectionReasonCode: reasonCode,
          rejectionReasonText: reasonText,
        },
      });
      if (rejected.count !== 1) throw new Error("SPECIMEN_STATE_CHANGED");

      await tx.specimenEvent.create({
        data: {
          specimenId: specimen.id,
          eventType: "REJECTED",
          branchId,
          actorUserId: session.user.id,
          fromStatus: specimen.status,
          toStatus: "REJECTED",
          details: {
            reasonCode,
            reasonText,
            derivedAliquot: true,
            parentSpecimenId: specimen.parentSpecimenId,
            parentBarcode: specimen.parentSpecimen?.barcode || null,
            replacementStrategy: "DERIVE_NEW_ALIQUOT_FROM_PARENT",
          },
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "SPECIMEN_ALIQUOT_REJECTED",
          entityType: "Specimen",
          entityId: specimen.id,
          oldValues: { status: specimen.status },
          newValues: {
            status: "REJECTED",
            reasonCode,
            reasonText,
            parentSpecimenId: specimen.parentSpecimenId,
            parentBarcode: specimen.parentSpecimen?.barcode || null,
            automaticPatientRecollectionCreated: false,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return true;
    });

    return NextResponse.json({
      status: "ok",
      rejectedSpecimenId: specimen.id,
      replacementType: "ALIQUOT",
      parentSpecimenId: specimen.parentSpecimenId,
      parentBarcode: specimen.parentSpecimen?.barcode || null,
    });
  }

  const result = await prisma.$transaction(async (tx) => {
    const rejected = await tx.specimen.updateMany({
      where: { id: specimen.id, status: specimen.status },
      data: {
        status: "REJECTED",
        currentBranchId: branchId,
        rejectedByUserId: session.user.id,
        rejectedAt: new Date(),
        rejectionReasonCode: reasonCode,
        rejectionReasonText: reasonText,
      },
    });
    if (rejected.count !== 1) throw new Error("SPECIMEN_STATE_CHANGED");

    await tx.specimenEvent.create({
      data: {
        specimenId: specimen.id,
        eventType: "REJECTED",
        branchId,
        actorUserId: session.user.id,
        fromStatus: specimen.status,
        toStatus: "REJECTED",
        details: { reasonCode, reasonText },
      },
    });

    const maxSequence = await tx.specimen.aggregate({
      where: { orderId: specimen.orderId },
      _max: { sequenceNumber: true },
    });
    const nextSequence = (maxSequence._max.sequenceNumber || 0) + 1;
    const replacementBarcode = `${specimen.order.accessionNumber}-${String(nextSequence).padStart(2, "0")}`;

    const replacement = await tx.specimen.create({
      data: {
        organizationId: specimen.organizationId,
        orderId: specimen.orderId,
        parentSpecimenId: specimen.id,
        parentRelationType: "RECOLLECTION",
        specimenTypeId: specimen.specimenTypeId,
        containerId: specimen.containerId,
        barcode: replacementBarcode,
        sequenceNumber: nextSequence,
        currentBranchId: specimen.order.orderingBranchId,
        notes: `Recollection after rejection of ${specimen.barcode}`,
      },
    });

    const linkedIds = specimen.orderItems.map((link) => link.orderItemId);
    if (linkedIds.length) {
      await tx.specimenOrderItem.createMany({
        data: linkedIds.map((orderItemId) => ({ specimenId: replacement.id, orderItemId })),
      });
      await tx.orderItem.updateMany({
        where: { id: { in: linkedIds }, status: { not: "CANCELLED" } },
        data: { status: "ORDERED" },
      });
    }

    await tx.specimenEvent.create({
      data: {
        specimenId: replacement.id,
        eventType: "CREATED",
        branchId: specimen.order.orderingBranchId,
        actorUserId: session.user.id,
        fromStatus: null,
        toStatus: "PLANNED",
        details: requirementSnapshot ? {
          requirementsFinalized: true,
          requirementEngineVersion: 1,
          recollectionForSpecimenId: specimen.id,
          rejectedBarcode: specimen.barcode,
          requiredVolume: requirementSnapshot.requiredVolume,
          requiredVolumeUnit: requirementSnapshot.requiredVolumeUnit,
          volumeRequirementComplete: requirementSnapshot.volumeRequirementComplete,
          collectionInstructions: requirementSnapshot.collectionInstructions,
          storageConditions: requirementSnapshot.storageConditions,
          stabilityMinutes: requirementSnapshot.stabilityMinutes,
          shared: requirementSnapshot.shared,
          configurationComplete: requirementSnapshot.configurationComplete,
          requirementMembers: requirementSnapshot.requirementMembers,
        } : {
          recollectionForSpecimenId: specimen.id,
          rejectedBarcode: specimen.barcode,
          requirementsFinalized: false,
        },
      },
    });

    if (specimen.order.status !== "CANCELLED" && specimen.order.status !== "REGISTERED") {
      await tx.labOrder.update({ where: { id: specimen.orderId }, data: { status: "REGISTERED" } });
      await tx.orderStatusHistory.create({
        data: {
          orderId: specimen.orderId,
          fromStatus: specimen.order.status,
          toStatus: "REGISTERED",
          reason: `Recollection required: ${reasonCode}`,
          changedByUserId: session.user.id,
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        actorUserId: session.user.id,
        action: "SPECIMEN_REJECTED",
        entityType: "Specimen",
        entityId: specimen.id,
        oldValues: { status: specimen.status },
        newValues: {
          status: "REJECTED",
          reasonCode,
          reasonText,
          replacementSpecimenId: replacement.id,
          replacementBarcode,
          requirementSnapshotCarriedForward: Boolean(requirementSnapshot),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return replacement;
  }, { timeout: 30000 });

  return NextResponse.json({
    status: "ok",
    rejectedSpecimenId: specimen.id,
    replacementSpecimenId: result.id,
    replacementBarcode: result.barcode,
  });
}
