import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { specimenActionError } from "@/lib/clinical-safety";
import {
  specimenCollectionVolumeError,
  specimenRequirementSnapshotFromDetails,
} from "@/lib/specimen-requirement-engine";
import { receptionAssessmentError } from "@/lib/specimen-reception-policy";

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
    labelAssessment?: string;
    conditionCode?: string;
    temperatureC?: string | number;
    observedContainerCode?: string;
    discrepancyText?: string;
    receptionNotes?: string;
  } | null;

  if (!body?.action) return NextResponse.json({ error: "invalid_action" }, { status: 400 });

  const permission =
    body.action === "COLLECT" ? "specimens.collect" :
    body.action === "RECEIVE" ? "specimens.receive" :
    "specimens.reject";

  const session = await requirePermission(permission);
  const ctx = await requestContext();
  if (body.action === "COLLECT") {
    return NextResponse.json({ error: "dedicated_phlebotomy_workflow_required" }, { status: 409 });
  }
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
        where: {
          id: specimen.id,
          status: "PLANNED",
          preanalyticalVersion: specimen.preanalyticalVersion,
        },
        data: {
          status: "COLLECTED",
          preanalyticalVersion: { increment: 1 },
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

      const linkedIds = specimen.orderItems.filter(link => link.status === "ACTIVE").map(link => link.orderItemId);
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
    const labelAssessment = text(body.labelAssessment, 30);
    const conditionCode = text(body.conditionCode, 80).toUpperCase();
    const observedContainerCode = text(body.observedContainerCode, 80) || null;
    const discrepancyText = text(body.discrepancyText, 1000) || null;
    const receptionNotes = text(body.receptionNotes, 1000) || null;
    const temperatureText = body.temperatureC == null || body.temperatureC === "" ? "" : String(body.temperatureC);

    const receptionError = receptionAssessmentError({
      labelAssessment,
      conditionCode,
      temperatureC: temperatureText,
      expectedContainerCode: specimen.container?.code || null,
      observedContainerCode,
      discrepancyText,
    });
    if (receptionError) {
      return NextResponse.json({ error: receptionError }, { status: 400 });
    }

    const result = await prisma.$transaction(async (tx) => {
      const changed = await tx.specimen.updateMany({
        where: {
          id: specimen.id,
          status: specimen.status,
          preanalyticalVersion: specimen.preanalyticalVersion,
        },
        data: {
          status: "RECEIVED",
          preanalyticalVersion: { increment: 1 },
          currentBranchId: branchId,
          receivedByUserId: session.user.id,
          receivedAt: new Date(),
        },
      });
      if (changed.count !== 1) throw new Error("SPECIMEN_STATE_CHANGED");
      const updated = await tx.specimen.findUniqueOrThrow({ where: { id: specimen.id } });

      const assessment = await tx.specimenReceptionAssessment.create({
        data: {
          organizationId: session.user.organizationId,
          specimenId: specimen.id,
          branchId,
          receivedByUserId: session.user.id,
          barcodeSnapshot: specimen.barcode,
          expectedContainerCodeSnapshot: specimen.container?.code || null,
          observedContainerCode,
          labelAssessment: labelAssessment as "MATCHED" | "UNLABELED" | "MISMATCHED",
          conditionCode,
          temperatureC: temperatureText || null,
          discrepancyText,
          notes: receptionNotes,
        },
      });

      await tx.specimenEvent.create({
        data: {
          specimenId: specimen.id,
          eventType: "RECEIVED",
          branchId,
          actorUserId: session.user.id,
          fromStatus: specimen.status,
          toStatus: "RECEIVED",
          details: {
            previousBranchId: specimen.currentBranchId,
            receptionAssessmentId: assessment.id,
            labelAssessment,
            conditionCode,
            expectedContainerCode: specimen.container?.code || null,
            observedContainerCode,
            temperatureC: temperatureText || null,
            discrepancyText,
            notes: receptionNotes,
          },
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
          newValues: {
            barcode: specimen.barcode,
            status: "RECEIVED",
            currentBranchId: branchId,
            receptionAssessmentId: assessment.id,
            labelAssessment,
            conditionCode,
            expectedContainerCode: specimen.container?.code || null,
            observedContainerCode,
            temperatureC: temperatureText || null,
            discrepancyText,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return updated;
    });

    return NextResponse.json({ status: "ok", specimen: result });
  }

  return NextResponse.json({ error: "dedicated_rejection_workflow_required" }, { status: 409 });
}
