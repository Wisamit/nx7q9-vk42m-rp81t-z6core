import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { specimenActionError } from "@/lib/clinical-safety";
import { buildSpecimenPlans, specimenRequirementSnapshotFromDetails } from "@/lib/specimen-requirement-engine";
import {
  activeDerivedAliquotConflict,
  selectedRejectionOrderItemIds,
  selectiveRejectionNeedsPatientRecollection,
} from "@/lib/specimen-reception-policy";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

class SpecimenRejectionStateChanged extends Error {}

function requirementDetailsForRecollection(input: {
  snapshot: ReturnType<typeof specimenRequirementSnapshotFromDetails>;
  affectedOrderItemIds: readonly string[];
  specimenTypeId: string | null;
  specimenTypeCode: string | null;
  containerId: string | null;
  containerCode: string | null;
  sourceSpecimenId: string;
  sourceBarcode: string;
}) {
  if (!input.snapshot) {
    return {
      recollectionForSpecimenId: input.sourceSpecimenId,
      rejectedBarcode: input.sourceBarcode,
      requirementsFinalized: false,
    };
  }

  const affected = new Set(input.affectedOrderItemIds);
  const members = input.snapshot.requirementMembers
    .filter((value): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value)))
    .filter(member => typeof member.orderItemId === "string" && affected.has(member.orderItemId))
    .map(member => ({
      orderItemId: String(member.orderItemId),
      testId: typeof member.testId === "string" ? member.testId : "",
      testCode: typeof member.testCode === "string" ? member.testCode : "",
      specimenTypeId: input.specimenTypeId,
      specimenTypeCode: input.specimenTypeCode,
      containerId: input.containerId,
      containerCode: input.containerCode,
      minimumVolume: typeof member.minimumVolume === "string" ? member.minimumVolume : null,
      minimumVolumeUnit: typeof member.minimumVolumeUnit === "string" ? member.minimumVolumeUnit : null,
      collectionInstructions: typeof member.collectionInstructions === "string" ? member.collectionInstructions : null,
      storageConditions: typeof member.storageConditions === "string" ? member.storageConditions : null,
      stabilityMinutes: typeof member.stabilityMinutes === "number" ? member.stabilityMinutes : null,
    }));

  if (members.length !== input.affectedOrderItemIds.length) {
    return {
      recollectionForSpecimenId: input.sourceSpecimenId,
      rejectedBarcode: input.sourceBarcode,
      requirementsFinalized: false,
      sourceRequirementSnapshotIncomplete: true,
    };
  }

  const plans = buildSpecimenPlans(members);
  if (plans.length !== 1) {
    return {
      recollectionForSpecimenId: input.sourceSpecimenId,
      rejectedBarcode: input.sourceBarcode,
      requirementsFinalized: false,
      sourceRequirementSnapshotIncompatible: true,
    };
  }

  const plan = plans[0];
  return {
    requirementsFinalized: true,
    requirementEngineVersion: 1,
    recollectionForSpecimenId: input.sourceSpecimenId,
    rejectedBarcode: input.sourceBarcode,
    requiredVolume: plan.requiredVolume,
    requiredVolumeUnit: plan.requiredVolumeUnit,
    volumeRequirementComplete: plan.volumeRequirementComplete,
    collectionInstructions: plan.collectionInstructions,
    storageConditions: plan.storageConditions,
    stabilityMinutes: plan.stabilityMinutes,
    shared: plan.shared,
    configurationComplete: plan.configurationComplete,
    requirementMembers: plan.members,
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("specimens.reject");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36) || session.activeBranchId;
  if (!branchId || !canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const rejectionReasonId = text(body.rejectionReasonId, 36);
  const reasonDetails = text(body.reasonDetails, 1000);
  const scope = body.scope === "WHOLE_SPECIMEN" || body.scope === "SELECTED_TESTS" ? body.scope : null;
  const requestedOrderItemIds = Array.isArray(body.orderItemIds)
    ? [...new Set(body.orderItemIds.filter((value): value is string => typeof value === "string" && value.length <= 36))]
    : [];

  if (!rejectionReasonId || !reasonDetails || !scope) {
    return NextResponse.json({ error: "rejection_reason_scope_required" }, { status: 400 });
  }

  const [specimen, reason] = await Promise.all([
    prisma.specimen.findFirst({
      where: { id, organizationId: session.user.organizationId },
      include: {
        order: true,
        specimenType: { select: { code: true } },
        container: { select: { code: true } },
        orderItems: {
          include: {
            orderItem: {
              include: {
                results: {
                  where: { status: { not: "CANCELLED" } },
                  select: { id: true, status: true },
                  take: 1,
                },
              },
            },
          },
        },
        childSpecimens: {
          where: { parentRelationType: "ALIQUOT" },
          select: {
            id: true,
            barcode: true,
            status: true,
            orderItems: {
              where: { status: "ACTIVE" },
              select: { orderItemId: true },
            },
          },
        },
        events: { where: { eventType: "CREATED" }, orderBy: { occurredAt: "asc" } },
      },
    }),
    prisma.specimenRejectionReason.findFirst({
      where: {
        id: rejectionReasonId,
        organizationId: session.user.organizationId,
        status: "ACTIVE",
      },
    }),
  ]);

  if (!specimen) return NextResponse.json({ error: "specimen_not_found" }, { status: 404 });
  if (!reason) return NextResponse.json({ error: "rejection_reason_not_active" }, { status: 409 });
  if (specimen.order.status === "CANCELLED") return NextResponse.json({ error: "order_cancelled" }, { status: 409 });
  if (specimen.order.status === "COMPLETED") {
    return NextResponse.json({ error: "completed_order_requires_result_amendment_workflow" }, { status: 409 });
  }

  const lifecycleError = specimenActionError({
    status: specimen.status,
    action: "REJECT",
    specimenTypeConfigured: Boolean(specimen.specimenTypeId),
  });
  if (lifecycleError) return NextResponse.json({ error: lifecycleError, status: specimen.status }, { status: 409 });

  const activeLinks = specimen.orderItems.filter(link =>
    link.status === "ACTIVE" && link.orderItem.status !== "CANCELLED"
  );
  const activeOrderItemIds = activeLinks.map(link => link.orderItemId);
  const affectedOrderItemIds = selectedRejectionOrderItemIds({
    scope,
    activeOrderItemIds,
    requestedOrderItemIds,
  });
  if (!affectedOrderItemIds) {
    return NextResponse.json({ error: "invalid_rejection_test_selection" }, { status: 400 });
  }
  if (scope === "SELECTED_TESTS" && affectedOrderItemIds.length === activeOrderItemIds.length) {
    return NextResponse.json({ error: "use_whole_specimen_scope_for_all_tests" }, { status: 409 });
  }

  const affectedSet = new Set(affectedOrderItemIds);
  if (activeLinks.some(link => affectedSet.has(link.orderItemId) && link.orderItem.results.length > 0)) {
    return NextResponse.json({ error: "affected_tests_already_have_results" }, { status: 409 });
  }

  const activeChildren = specimen.childSpecimens.filter(child => !["REJECTED","DISPOSED"].includes(child.status));
  if (scope === "WHOLE_SPECIMEN" && activeChildren.length > 0) {
    return NextResponse.json({
      error: "active_child_aliquots_require_resolution",
      childBarcodes: activeChildren.map(child => child.barcode),
    }, { status: 409 });
  }
  if (scope === "SELECTED_TESTS" && activeDerivedAliquotConflict({
    affectedOrderItemIds,
    childAliquots: activeChildren.map(child => ({
      status: child.status,
      orderItemIds: child.orderItems.map(link => link.orderItemId),
    })),
  })) {
    return NextResponse.json({ error: "affected_tests_have_active_child_aliquots" }, { status: 409 });
  }

  const requirementSnapshot = specimen.events
    .map(event => specimenRequirementSnapshotFromDetails(event.details))
    .find(Boolean) || null;
  const needsPatientRecollection = selectiveRejectionNeedsPatientRecollection(specimen.parentRelationType);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await prisma.$transaction(async tx => {
        const sourceChange = await tx.specimen.updateMany({
          where: {
            id: specimen.id,
            organizationId: session.user.organizationId,
            status: specimen.status,
            preanalyticalVersion: specimen.preanalyticalVersion,
          },
          data: scope === "WHOLE_SPECIMEN"
            ? {
                status: "REJECTED",
                currentBranchId: branchId,
                rejectedByUserId: session.user.id,
                rejectedAt: new Date(),
                rejectionReasonCode: reason.code,
                rejectionReasonText: reasonDetails,
                preanalyticalVersion: { increment: 1 },
              }
            : {
                preanalyticalVersion: { increment: 1 },
              },
        });
        if (sourceChange.count !== 1) throw new SpecimenRejectionStateChanged();

        const rejection = await tx.specimenRejection.create({
          data: {
            organizationId: session.user.organizationId,
            specimenId: specimen.id,
            branchId,
            rejectedByUserId: session.user.id,
            reasonId: reason.id,
            reasonCodeSnapshot: reason.code,
            reasonNameEnSnapshot: reason.nameEn,
            reasonNameArSnapshot: reason.nameAr,
            reasonDetails,
            scope,
          },
        });

        const rejectedLinks = await tx.specimenOrderItem.updateMany({
          where: {
            specimenId: specimen.id,
            orderItemId: { in: affectedOrderItemIds },
            status: "ACTIVE",
            rejectionId: null,
          },
          data: {
            status: "REJECTED",
            rejectionId: rejection.id,
          },
        });
        if (rejectedLinks.count !== affectedOrderItemIds.length) throw new SpecimenRejectionStateChanged();

        let replacement: { id: string; barcode: string } | null = null;
        if (needsPatientRecollection) {
          const maxSequence = await tx.specimen.aggregate({
            where: { orderId: specimen.orderId },
            _max: { sequenceNumber: true },
          });
          const nextSequence = (maxSequence._max.sequenceNumber || 0) + 1;
          const replacementBarcode = `${specimen.order.accessionNumber}-${String(nextSequence).padStart(2, "0")}`;

          replacement = await tx.specimen.create({
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
              notes: `Recollection after ${scope === "WHOLE_SPECIMEN" ? "whole-specimen" : "test-specific"} rejection of ${specimen.barcode}`,
            },
          });

          await tx.specimenOrderItem.createMany({
            data: affectedOrderItemIds.map(orderItemId => ({
              specimenId: replacement!.id,
              orderItemId,
            })),
          });

          const recollectionDetails = requirementDetailsForRecollection({
            snapshot: requirementSnapshot,
            affectedOrderItemIds,
            specimenTypeId: specimen.specimenTypeId,
            specimenTypeCode: specimen.specimenType?.code || null,
            containerId: specimen.containerId,
            containerCode: specimen.container?.code || null,
            sourceSpecimenId: specimen.id,
            sourceBarcode: specimen.barcode,
          });

          await tx.specimenEvent.create({
            data: {
              specimenId: replacement.id,
              eventType: "CREATED",
              branchId: specimen.order.orderingBranchId,
              actorUserId: session.user.id,
              fromStatus: null,
              toStatus: "PLANNED",
              details: recollectionDetails,
            },
          });

          await tx.specimenRejection.update({
            where: { id: rejection.id },
            data: { replacementSpecimenId: replacement.id },
          });

          await tx.orderItem.updateMany({
            where: {
              id: { in: affectedOrderItemIds },
              status: { not: "CANCELLED" },
            },
            data: { status: "ORDERED" },
          });

          if (scope === "WHOLE_SPECIMEN"
            && specimen.order.status !== "REGISTERED"
            && specimen.order.status !== "CANCELLED") {
            await tx.labOrder.update({
              where: { id: specimen.orderId },
              data: { status: "REGISTERED" },
            });
            await tx.orderStatusHistory.create({
              data: {
                orderId: specimen.orderId,
                fromStatus: specimen.order.status,
                toStatus: "REGISTERED",
                reason: `Whole specimen recollection required: ${reason.code}`,
                changedByUserId: session.user.id,
              },
            });
          }
        }

        await tx.specimenEvent.create({
          data: {
            specimenId: specimen.id,
            eventType: "REJECTED",
            branchId,
            actorUserId: session.user.id,
            fromStatus: specimen.status,
            toStatus: scope === "WHOLE_SPECIMEN" ? "REJECTED" : specimen.status,
            details: {
              rejectionId: rejection.id,
              scope,
              reasonCode: reason.code,
              reasonNameEn: reason.nameEn,
              reasonNameAr: reason.nameAr,
              reasonDetails,
              affectedOrderItemIds,
              replacementSpecimenId: replacement?.id || null,
              replacementBarcode: replacement?.barcode || null,
              replacementStrategy: needsPatientRecollection ? "PATIENT_RECOLLECTION" : "DERIVE_NEW_ALIQUOT_FROM_PARENT",
            },
          },
        });

        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId,
            actorUserId: session.user.id,
            action: scope === "WHOLE_SPECIMEN" ? "SPECIMEN_REJECTED" : "SPECIMEN_TESTS_REJECTED",
            entityType: "Specimen",
            entityId: specimen.id,
            reason: reasonDetails,
            oldValues: {
              status: specimen.status,
              activeOrderItemIds,
            },
            newValues: {
              status: scope === "WHOLE_SPECIMEN" ? "REJECTED" : specimen.status,
              rejectionId: rejection.id,
              scope,
              reasonCode: reason.code,
              reasonNameEn: reason.nameEn,
              reasonNameAr: reason.nameAr,
              affectedOrderItemIds,
              replacementSpecimenId: replacement?.id || null,
              replacementBarcode: replacement?.barcode || null,
            },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });

        return { rejection, replacement };
      }, { timeout: 30000 });

      return NextResponse.json({
        status: "ok",
        rejectionId: result.rejection.id,
        scope,
        affectedOrderItemIds,
        replacementType: needsPatientRecollection ? "PATIENT_RECOLLECTION" : "ALIQUOT",
        replacementSpecimenId: result.replacement?.id || null,
        replacementBarcode: result.replacement?.barcode || null,
        parentSpecimenId: specimen.parentRelationType === "ALIQUOT" ? specimen.parentSpecimenId : null,
      }, { status: 201 });
    } catch (error) {
      if (error instanceof SpecimenRejectionStateChanged) {
        return NextResponse.json({ error: "specimen_preanalytical_state_changed" }, { status: 409 });
      }
      if (error && typeof error === "object" && "code" in error && error.code === "P2002" && attempt < 2) {
        continue;
      }
      throw error;
    }
  }

  return NextResponse.json({ error: "recollection_sequence_conflict" }, { status: 409 });
}
