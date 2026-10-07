import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildSpecimenPlans,
  specimenRequirementSnapshotFromDetails,
  type SpecimenRequirementInput,
} from "@/lib/specimen-requirement-engine";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("orders.create");
  const ctx = await requestContext();
  const { id } = await params;

  const order = await prisma.labOrder.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      specimens: {
        include: {
          specimenType: true,
          container: true,
          events: { where: { eventType: "CREATED" }, orderBy: { occurredAt: "asc" } },
          orderItems: {
            include: {
              orderItem: {
                include: {
                  test: { include: { specimenType: true, container: true } },
                },
              },
            },
          },
        },
        orderBy: { sequenceNumber: "asc" },
      },
    },
  });
  if (!order) return NextResponse.json({ error: "order_not_found" }, { status: 404 });
  if (!canAccessBranch(session, order.orderingBranchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }
  if (order.status === "CANCELLED") {
    return NextResponse.json({ error: "cancelled_order_requirements_not_finalizable" }, { status: 409 });
  }

  const finalization = order.specimens.map(specimen => {
    const existing = specimen.events
      .map(event => specimenRequirementSnapshotFromDetails(event.details))
      .find(Boolean) || null;
    if (existing) return { specimen, existing, plan: null, error: null as string | null };
    if (specimen.status !== "PLANNED") {
      return { specimen, existing: null, plan: null, error: "non_planned_specimen_without_requirement_snapshot" };
    }
    if (specimen.orderItems.length === 0) {
      return { specimen, existing: null, plan: null, error: "specimen_has_no_order_items" };
    }

    const inputs: SpecimenRequirementInput[] = specimen.orderItems.map(link => {
      const item = link.orderItem;
      const test = item.test;
      return {
        orderItemId: item.id,
        testId: test.id,
        testCode: item.testCodeSnapshot,
        specimenTypeId: test.specimenTypeId,
        specimenTypeCode: test.specimenType?.code || null,
        containerId: test.containerId,
        containerCode: test.container?.code || null,
        minimumVolume: test.minimumVolume?.toFixed(3) || null,
        minimumVolumeUnit: test.minimumVolumeUnit,
        collectionInstructions: test.collectionInstructions,
        storageConditions: test.storageConditions,
        stabilityMinutes: test.stabilityMinutes,
      };
    });
    const plans = buildSpecimenPlans(inputs);
    if (plans.length !== 1) {
      return { specimen, existing: null, plan: null, error: "incompatible_specimen_requirements" };
    }
    const plan = plans[0];
    if (plan.specimenTypeId !== specimen.specimenTypeId || plan.containerId !== specimen.containerId) {
      return { specimen, existing: null, plan: null, error: "specimen_plan_catalog_mismatch" };
    }
    return { specimen, existing: null, plan, error: null as string | null };
  });

  const failed = finalization.find(item => item.error);
  if (failed) {
    return NextResponse.json({
      error: failed.error,
      specimenId: failed.specimen.id,
      barcode: failed.specimen.barcode,
      testCodes: failed.specimen.orderItems.map(link => link.orderItem.testCodeSnapshot),
    }, { status: 409 });
  }

  const pending = finalization.filter(item => item.plan);
  if (pending.length === 0) {
    return NextResponse.json({ status: "ok", finalized: 0, alreadyFinalized: order.specimens.length });
  }

  await prisma.$transaction(async tx => {
    for (const item of pending) {
      const plan = item.plan!;
      const current = await tx.specimen.findUnique({ where: { id: item.specimen.id }, select: { status: true } });
      if (!current || current.status !== "PLANNED") throw new Error("SPECIMEN_STATE_CHANGED");
      const events = await tx.specimenEvent.findMany({
        where: { specimenId: item.specimen.id, eventType: "CREATED" },
        select: { details: true },
      });
      if (events.some(event => specimenRequirementSnapshotFromDetails(event.details))) continue;

      await tx.specimenEvent.create({
        data: {
          specimenId: item.specimen.id,
          eventType: "CREATED",
          branchId: order.orderingBranchId,
          actorUserId: session.user.id,
          fromStatus: null,
          toStatus: "PLANNED",
          details: {
            requirementsFinalized: true,
            requirementEngineVersion: 1,
            barcode: item.specimen.barcode,
            specimenTypeId: plan.specimenTypeId,
            specimenTypeCode: plan.specimenTypeCode,
            containerId: plan.containerId,
            containerCode: plan.containerCode,
            requiredVolume: plan.requiredVolume,
            requiredVolumeUnit: plan.requiredVolumeUnit,
            volumeRequirementComplete: plan.volumeRequirementComplete,
            collectionInstructions: plan.collectionInstructions,
            storageConditions: plan.storageConditions,
            stabilityMinutes: plan.stabilityMinutes,
            shared: plan.shared,
            configurationComplete: plan.configurationComplete,
            orderItemIds: plan.orderItemIds,
            requirementMembers: plan.members,
          },
        },
      });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: order.orderingBranchId,
        actorUserId: session.user.id,
        action: "SPECIMEN_REQUIREMENTS_FINALIZED",
        entityType: "LabOrder",
        entityId: order.id,
        newValues: {
          accessionNumber: order.accessionNumber,
          engineVersion: 1,
          finalizedSpecimenCount: pending.length,
          specimens: pending.map(item => ({
            specimenId: item.specimen.id,
            barcode: item.specimen.barcode,
            requiredVolume: item.plan!.requiredVolume,
            requiredVolumeUnit: item.plan!.requiredVolumeUnit,
            shared: item.plan!.shared,
            testCodes: item.plan!.members.map(member => member.testCode),
          })),
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }, { timeout: 30000 });

  return NextResponse.json({
    status: "ok",
    finalized: pending.length,
    alreadyFinalized: order.specimens.length - pending.length,
  });
}
