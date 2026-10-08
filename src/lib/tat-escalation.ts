import { NotificationSeverity, Prisma, PrismaClient } from "../../generated/prisma/client";
import { notifyUsersWithPermission } from "@/lib/notifications";
import { tatEscalationLevelsDue } from "@/lib/tat";

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export async function processTatEscalations(
  db: PrismaClient,
  organizationId: string,
  now = new Date(),
  limit = 200,
) {
  await db.tatEscalationEvent.updateMany({
    where: {
      organizationId,
      status: "OPEN",
      orderItem: { status: { in: ["VERIFIED", "CANCELLED"] } },
    },
    data: { status: "CLOSED", closedAt: now },
  });

  const items = await db.orderItem.findMany({
    where: {
      order: { organizationId },
      status: { notIn: ["VERIFIED", "CANCELLED"] },
      tatFirstEscalationAt: { not: null, lte: now },
      tatDueAt: { not: null },
      tatMaxEscalationLevelSnapshot: { not: null },
      tatEscalationPermissionCodeSnapshot: { not: null },
    },
    include: {
      order: {
        select: {
          accessionNumber: true,
          orderingBranchId: true,
          patient: { select: { patientNumber: true, fullNameEn: true, fullNameAr: true } },
        },
      },
      specimenLinks: {
        where: { status: "ACTIVE" },
        include: { specimen: { select: { currentBranchId: true, status: true } } },
        orderBy: { createdAt: "desc" },
      },
      tatEscalations: {
        orderBy: { level: "desc" },
        take: 1,
        select: { level: true },
      },
    },
    orderBy: { tatFirstEscalationAt: "asc" },
    take: Math.min(Math.max(limit, 1), 500),
  });

  const created: Array<{
    eventId: string;
    orderItemId: string;
    level: number;
    branchId: string;
    recipientCount: number;
  }> = [];

  for (const item of items) {
    if (
      !item.tatFirstEscalationAt
      || !item.tatDueAt
      || !item.tatMaxEscalationLevelSnapshot
      || !item.tatEscalationPermissionCodeSnapshot
    ) continue;

    const latestLevel = item.tatEscalations[0]?.level || 0;
    const dueLevels = tatEscalationLevelsDue({
      firstEscalationAt: item.tatFirstEscalationAt,
      repeatMinutes: item.tatEscalationRepeatMinutesSnapshot,
      maxLevel: item.tatMaxEscalationLevelSnapshot,
      latestLevel,
      now,
    });

    const currentSpecimenBranchId = item.specimenLinks
      .map(link => link.specimen)
      .find(specimen => !["REJECTED", "DISPOSED", "COLLECTION_FAILED"].includes(specimen.status))
      ?.currentBranchId || null;
    const branchId = currentSpecimenBranchId || item.performedBranchId || item.order.orderingBranchId;

    for (const due of dueLevels) {
      try {
        const evidence = await db.$transaction(async tx => {
          const event = await tx.tatEscalationEvent.create({
            data: {
              organizationId,
              branchId,
              orderItemId: item.id,
              level: due.level,
              tatDueAtSnapshot: item.tatDueAt!,
              escalationDueAtSnapshot: due.dueAt,
              permissionCodeSnapshot: item.tatEscalationPermissionCodeSnapshot!,
            },
          });

          const overdueMinutes = Math.max(0, Math.floor((now.getTime() - item.tatDueAt!.getTime()) / 60_000));
          const recipientCount = await notifyUsersWithPermission(tx, {
            organizationId,
            branchId,
            permissionCode: item.tatEscalationPermissionCodeSnapshot!,
            eventCode: "TAT_BREACH",
            title: `TAT breach L${due.level} · ${item.testCodeSnapshot}`,
            body: `${item.order.accessionNumber} · ${item.order.patient.patientNumber} · ${item.testNameEnSnapshot} · overdue ${overdueMinutes} min`,
            severity: due.level >= item.tatMaxEscalationLevelSnapshot!
              ? NotificationSeverity.CRITICAL
              : NotificationSeverity.WARNING,
            entityType: "TatEscalationEvent",
            entityId: event.id,
            metadata: {
              orderItemId: item.id,
              accessionNumber: item.order.accessionNumber,
              patientNumber: item.order.patient.patientNumber,
              testCode: item.testCodeSnapshot,
              testNameEn: item.testNameEnSnapshot,
              testNameAr: item.testNameArSnapshot,
              level: due.level,
              maxLevel: item.tatMaxEscalationLevelSnapshot!,
              tatDueAt: item.tatDueAt!.toISOString(),
              escalationDueAt: due.dueAt.toISOString(),
              overdueMinutes,
              permissionCode: item.tatEscalationPermissionCodeSnapshot!,
            },
          });

          const updated = await tx.tatEscalationEvent.update({
            where: { id: event.id },
            data: { recipientCount },
          });

          await tx.auditEvent.create({
            data: {
              organizationId,
              branchId,
              actorUserId: null,
              action: "TAT_BREACH_ESCALATED",
              entityType: "TatEscalationEvent",
              entityId: event.id,
              newValues: {
                orderItemId: item.id,
                accessionNumber: item.order.accessionNumber,
                testCode: item.testCodeSnapshot,
                level: due.level,
                maxLevel: item.tatMaxEscalationLevelSnapshot!,
                tatDueAt: item.tatDueAt!.toISOString(),
                escalationDueAt: due.dueAt.toISOString(),
                overdueMinutes,
                permissionCode: item.tatEscalationPermissionCodeSnapshot!,
                recipientCount,
              },
            },
          });

          return updated;
        }, { timeout: 30000 });

        created.push({
          eventId: evidence.id,
          orderItemId: item.id,
          level: due.level,
          branchId,
          recipientCount: evidence.recipientCount,
        });
      } catch (error) {
        if (isUniqueViolation(error)) continue;
        throw error;
      }
    }
  }

  return created;
}
