import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { specimenActionError } from "@/lib/clinical-safety";
import {
  specimenCollectionVolumeError,
  specimenRequirementSnapshotFromDetails,
} from "@/lib/specimen-requirement-engine";
import {
  collectionLocationError,
  failedCollectionReasonError,
  verifyCollectionPatientIdentity,
} from "@/lib/phlebotomy-policy";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

const FAILED_COLLECTION_REASONS = new Set([
  "NO_VENOUS_ACCESS",
  "PATIENT_REFUSED",
  "PATIENT_UNAVAILABLE",
  "PATIENT_UNWELL",
  "COLLECTION_INTERRUPTED",
  "EQUIPMENT_SUPPLY_ISSUE",
  "OTHER",
]);

class CollectionStateChanged extends Error {}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.collect");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const outcome = body.outcome === "SUCCESS" || body.outcome === "FAILED" ? body.outcome : null;
  const branchId = text(body.branchId, 36) || session.activeBranchId;
  const enteredName = text(body.patientName, 220);
  const secondaryType = text(body.secondaryVerificationType, 40);
  const secondaryValue = text(body.secondaryVerificationValue, 160);
  const locationType = text(body.collectionLocationType, 30);
  const locationText = text(body.collectionLocationText, 250) || null;
  const notes = text(body.notes, 1000) || null;

  if (!outcome) return NextResponse.json({ error: "invalid_collection_outcome" }, { status: 400 });
  if (!branchId || !canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  const collectionBranch = await prisma.branch.findFirst({
    where: {
      id: branchId,
      organizationId: session.user.organizationId,
      status: "ACTIVE",
    },
    select: { id: true, code: true, nameEn: true, nameAr: true },
  });
  if (!collectionBranch) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });

  const locationError = collectionLocationError({ locationType, locationText });
  if (locationError) return NextResponse.json({ error: locationError }, { status: 400 });

  const specimen = await prisma.specimen.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      order: {
        include: {
          patient: {
            include: {
              identifiers: {
                where: { status: "ACTIVE" },
                select: { identifierType: true, normalizedValue: true, status: true },
              },
            },
          },
        },
      },
      specimenType: true,
      container: true,
      orderItems: {
        where: { status: "ACTIVE" },
        include: { orderItem: true },
      },
      events: {
        where: { eventType: "CREATED" },
        orderBy: { occurredAt: "asc" },
      },
    },
  });
  if (!specimen) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });
  if (!specimen.currentBranchId || specimen.currentBranchId !== branchId) {
    return NextResponse.json({ error: "collection_branch_must_match_specimen_location" }, { status: 409 });
  }
  if (specimen.order.status === "CANCELLED") {
    return NextResponse.json({ error: "order_cancelled" }, { status: 409 });
  }

  const lifecycleError = specimenActionError({
    status: specimen.status,
    action: "COLLECT",
    specimenTypeConfigured: Boolean(specimen.specimenTypeId),
  });
  if (lifecycleError) {
    return NextResponse.json({ error: lifecycleError, status: specimen.status }, { status: 409 });
  }

  const requirementSnapshot = specimen.events
    .map(event => specimenRequirementSnapshotFromDetails(event.details))
    .find(Boolean) || null;
  if (!requirementSnapshot) {
    return NextResponse.json({ error: "specimen_requirements_not_finalized" }, { status: 409 });
  }
  if (!requirementSnapshot.configurationComplete) {
    return NextResponse.json({ error: "specimen_requirement_configuration_incomplete" }, { status: 409 });
  }
  if (specimen.orderItems.length === 0) {
    return NextResponse.json({ error: "specimen_has_no_active_order_items" }, { status: 409 });
  }

  const patient = specimen.order.patient;
  const verification = verifyCollectionPatientIdentity({
    patient: {
      fullNameEn: patient.fullNameEn,
      fullNameAr: patient.fullNameAr,
      patientNumber: patient.patientNumber,
      dateOfBirth: patient.dateOfBirth?.toISOString().slice(0, 10) || null,
      normalizedPhone: patient.normalizedPhone,
      identifiers: patient.identifiers.map(identifier => ({
        identifierType: identifier.identifierType,
        normalizedValue: identifier.normalizedValue,
        status: identifier.status,
      })),
    },
    enteredName,
    secondaryType,
    secondaryValue,
  });
  if (!verification.ok) {
    return NextResponse.json({ error: verification.error }, { status: 409 });
  }

  const volumeText = body.volume == null || body.volume === "" ? "" : String(body.volume);
  const volumeUnit = text(body.volumeUnit, 30) || null;
  if (outcome === "SUCCESS") {
    const volume = volumeText ? Number(volumeText) : null;
    if (volume !== null && (!Number.isFinite(volume) || volume < 0)) {
      return NextResponse.json({ error: "invalid_volume" }, { status: 400 });
    }
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

    const attemptedAt = new Date();
    const result = await prisma.$transaction(async tx => {
      const changed = await tx.specimen.updateMany({
        where: {
          id: specimen.id,
          organizationId: session.user.organizationId,
          status: "PLANNED",
          preanalyticalVersion: specimen.preanalyticalVersion,
          orderItems: { some: { status: "ACTIVE" } },
        },
        data: {
          status: "COLLECTED",
          preanalyticalVersion: { increment: 1 },
          collectionBranchId: branchId,
          currentBranchId: branchId,
          collectedByUserId: session.user.id,
          collectedAt: attemptedAt,
          volume: volume === null ? null : volume.toFixed(3),
          volumeUnit,
          remainingVolume: volume === null ? null : volume.toFixed(3),
          remainingVolumeUnit: volume === null ? null : volumeUnit,
          notes,
        },
      });
      if (changed.count !== 1) throw new CollectionStateChanged();

      const attempt = await tx.specimenCollectionAttempt.create({
        data: {
          organizationId: session.user.organizationId,
          specimenId: specimen.id,
          branchId,
          collectorUserId: session.user.id,
          branchCodeSnapshot: collectionBranch.code,
          branchNameEnSnapshot: collectionBranch.nameEn,
          branchNameArSnapshot: collectionBranch.nameAr,
          collectorNameEnSnapshot: session.user.displayNameEn,
          collectorNameArSnapshot: session.user.displayNameAr,
          outcome: "SUCCESS",
          patientNameSnapshot: verification.matchedNameSnapshot,
          patientNumberSnapshot: verification.patientNumberSnapshot,
          secondaryVerificationType: verification.secondaryType,
          secondaryVerificationSnapshot: verification.secondarySnapshot,
          collectionLocationType: locationType as "BRANCH" | "HOME" | "OTHER",
          collectionLocationText: locationText,
          volume: volume === null ? null : volume.toFixed(3),
          volumeUnit,
          notes,
          attemptedAt,
        },
      });

      const linkedIds = specimen.orderItems.map(link => link.orderItemId);
      await tx.orderItem.updateMany({
        where: { id: { in: linkedIds }, status: "ORDERED" },
        data: { status: "COLLECTED" },
      });

      const remaining = await tx.orderItem.count({
        where: { orderId: specimen.orderId, status: "ORDERED" },
      });
      if (remaining === 0 && specimen.order.status === "REGISTERED") {
        await tx.labOrder.update({
          where: { id: specimen.orderId },
          data: { status: "COLLECTED" },
        });
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
            collectionAttemptId: attempt.id,
            collectionLocationType: locationType,
            collectionLocationText: locationText,
            patientVerification: {
              patientNameSnapshot: verification.matchedNameSnapshot,
              patientNumberSnapshot: verification.patientNumberSnapshot,
              secondaryType: verification.secondaryType,
              secondarySnapshot: verification.secondarySnapshot,
            },
            volume: volume === null ? null : volume.toFixed(3),
            volumeUnit,
            requiredVolume: requirementSnapshot.requiredVolume,
            requiredVolumeUnit: requirementSnapshot.requiredVolumeUnit,
            volumeRequirementMet: true,
            notes,
          },
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "SPECIMEN_COLLECTION_SUCCEEDED",
          entityType: "SpecimenCollectionAttempt",
          entityId: attempt.id,
          newValues: {
            specimenId: specimen.id,
            barcode: specimen.barcode,
            patientId: patient.id,
            patientNumber: patient.patientNumber,
            outcome: "SUCCESS",
            collectionLocationType: locationType,
            collectionLocationText: locationText,
            secondaryVerificationType: verification.secondaryType,
            collectedVolume: volume === null ? null : volume.toFixed(3),
            collectedVolumeUnit: volumeUnit,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return attempt;
    }, { timeout: 30000 }).catch(error => {
      if (error instanceof CollectionStateChanged) return null;
      throw error;
    });

    if (!result) {
      return NextResponse.json({ error: "specimen_preanalytical_state_changed" }, { status: 409 });
    }
    return NextResponse.json({ status: "ok", outcome: "SUCCESS", collectionAttemptId: result.id });
  }

  const reasonCode = text(body.failureReasonCode, 80).toUpperCase();
  const reasonText = text(body.failureReasonText, 1000);
  if (!FAILED_COLLECTION_REASONS.has(reasonCode)) {
    return NextResponse.json({ error: "invalid_failed_collection_reason" }, { status: 400 });
  }
  const failureError = failedCollectionReasonError({ reasonCode, reasonText });
  if (failureError) return NextResponse.json({ error: failureError }, { status: 400 });

  for (let retry = 0; retry < 3; retry += 1) {
    try {
      const attemptedAt = new Date();
      const result = await prisma.$transaction(async tx => {
        const changed = await tx.specimen.updateMany({
          where: {
            id: specimen.id,
            organizationId: session.user.organizationId,
            status: "PLANNED",
            preanalyticalVersion: specimen.preanalyticalVersion,
            orderItems: { some: { status: "ACTIVE" } },
          },
          data: {
            status: "COLLECTION_FAILED",
            preanalyticalVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new CollectionStateChanged();

        const linkedIds = specimen.orderItems.map(link => link.orderItemId);
        const failedLinks = await tx.specimenOrderItem.updateMany({
          where: {
            specimenId: specimen.id,
            orderItemId: { in: linkedIds },
            status: "ACTIVE",
          },
          data: { status: "FAILED_COLLECTION" },
        });
        if (failedLinks.count !== linkedIds.length) throw new CollectionStateChanged();

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
            currentBranchId: branchId,
            notes: `Recollection after failed collection of ${specimen.barcode}`,
          },
        });

        await tx.specimenOrderItem.createMany({
          data: linkedIds.map(orderItemId => ({
            specimenId: replacement.id,
            orderItemId,
          })),
        });

        await tx.specimenEvent.create({
          data: {
            specimenId: replacement.id,
            eventType: "CREATED",
            branchId,
            actorUserId: session.user.id,
            fromStatus: null,
            toStatus: "PLANNED",
            details: {
              requirementsFinalized: true,
              requirementEngineVersion: 1,
              failedCollectionForSpecimenId: specimen.id,
              failedBarcode: specimen.barcode,
              failureReasonCode: reasonCode,
              requiredVolume: requirementSnapshot.requiredVolume,
              requiredVolumeUnit: requirementSnapshot.requiredVolumeUnit,
              volumeRequirementComplete: requirementSnapshot.volumeRequirementComplete,
              collectionInstructions: requirementSnapshot.collectionInstructions,
              storageConditions: requirementSnapshot.storageConditions,
              stabilityMinutes: requirementSnapshot.stabilityMinutes,
              shared: requirementSnapshot.shared,
              configurationComplete: requirementSnapshot.configurationComplete,
              requirementMembers: requirementSnapshot.requirementMembers,
            },
          },
        });

        const attempt = await tx.specimenCollectionAttempt.create({
          data: {
            organizationId: session.user.organizationId,
            specimenId: specimen.id,
            replacementSpecimenId: replacement.id,
            branchId,
            collectorUserId: session.user.id,
            branchCodeSnapshot: collectionBranch.code,
            branchNameEnSnapshot: collectionBranch.nameEn,
            branchNameArSnapshot: collectionBranch.nameAr,
            collectorNameEnSnapshot: session.user.displayNameEn,
            collectorNameArSnapshot: session.user.displayNameAr,
            outcome: "FAILED",
            patientNameSnapshot: verification.matchedNameSnapshot,
            patientNumberSnapshot: verification.patientNumberSnapshot,
            secondaryVerificationType: verification.secondaryType,
            secondaryVerificationSnapshot: verification.secondarySnapshot,
            collectionLocationType: locationType as "BRANCH" | "HOME" | "OTHER",
            collectionLocationText: locationText,
            failureReasonCode: reasonCode,
            failureReasonText: reasonText,
            notes,
            attemptedAt,
          },
        });

        await tx.specimenEvent.create({
          data: {
            specimenId: specimen.id,
            eventType: "COLLECTION_FAILED",
            branchId,
            actorUserId: session.user.id,
            fromStatus: "PLANNED",
            toStatus: "COLLECTION_FAILED",
            details: {
              collectionAttemptId: attempt.id,
              patientVerification: {
                patientNameSnapshot: verification.matchedNameSnapshot,
                patientNumberSnapshot: verification.patientNumberSnapshot,
                secondaryType: verification.secondaryType,
                secondarySnapshot: verification.secondarySnapshot,
              },
              collectionLocationType: locationType,
              collectionLocationText: locationText,
              failureReasonCode: reasonCode,
              failureReasonText: reasonText,
              replacementSpecimenId: replacement.id,
              replacementBarcode,
              notes,
            },
          },
        });

        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId,
            actorUserId: session.user.id,
            action: "SPECIMEN_COLLECTION_FAILED",
            entityType: "SpecimenCollectionAttempt",
            entityId: attempt.id,
            reason: reasonText,
            newValues: {
              specimenId: specimen.id,
              failedBarcode: specimen.barcode,
              patientId: patient.id,
              patientNumber: patient.patientNumber,
              outcome: "FAILED",
              failureReasonCode: reasonCode,
              collectionLocationType: locationType,
              collectionLocationText: locationText,
              replacementSpecimenId: replacement.id,
              replacementBarcode,
              secondaryVerificationType: verification.secondaryType,
            },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });

        return { attempt, replacement };
      }, { timeout: 30000 });

      return NextResponse.json({
        status: "ok",
        outcome: "FAILED",
        collectionAttemptId: result.attempt.id,
        failedSpecimenId: specimen.id,
        replacementSpecimenId: result.replacement.id,
        replacementBarcode: result.replacement.barcode,
      }, { status: 201 });
    } catch (error) {
      if (error instanceof CollectionStateChanged) {
        return NextResponse.json({ error: "specimen_preanalytical_state_changed" }, { status: 409 });
      }
      if (error && typeof error === "object" && "code" in error && error.code === "P2002" && retry < 2) {
        continue;
      }
      throw error;
    }
  }

  return NextResponse.json({ error: "recollection_sequence_conflict" }, { status: 409 });
}
