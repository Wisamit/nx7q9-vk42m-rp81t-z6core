import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("equipment.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const equipment = await prisma.equipment.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { downtimeEvents: { where: { status: "OPEN" }, take: 1 } },
  });
  if (!equipment) return NextResponse.json({ error: "equipment_not_found" }, { status: 404 });
  if (!canAccessBranch(session, equipment.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const action = body.action;
  if (!["OPEN", "CLOSE", "RESTORE"].includes(action)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  const reason = text(body.reason);
  const resolution = text(body.resolution);
  if (action === "OPEN" && !reason) return NextResponse.json({ error: "downtime_reason_required" }, { status: 400 });
  if (action !== "OPEN" && !resolution) return NextResponse.json({ error: "resolution_required" }, { status: 400 });

  try {
    const result = await prisma.$transaction(async tx => {
      // Serialize equipment state transitions on the parent row before reading downtime.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM equipment WHERE id = ${equipment.id}
        AND organization_id = ${session.user.organizationId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("EQUIPMENT_NOT_FOUND");

      const now = new Date();
      const current = await tx.equipment.findFirst({
        where: { id: equipment.id, organizationId: session.user.organizationId },
        include: {
          downtimeEvents: { where: { status: "OPEN" }, take: 1 },
          calibrationEvents: { orderBy: { createdAt: "desc" }, take: 1 },
          maintenanceEvents: { where: { status: "IN_PROGRESS" }, take: 1 },
          maintenancePlans: { where: { status: "ACTIVE", nextDueAt: { lte: now } }, take: 1 },
        },
      });
      if (!current) throw new Error("EQUIPMENT_NOT_FOUND");
      const open = current.downtimeEvents[0];

      if (action === "OPEN") {
        if (open) throw new Error("DOWNTIME_ALREADY_OPEN");
        if (current.status === "RETIRED") throw new Error("EQUIPMENT_INACTIVE");
        const created = await tx.equipmentDowntime.create({
          data: {
            equipmentId: current.id,
            analyzerId: current.analyzerId,
            startedAt: now,
            reason,
            impact: text(body.impact) || null,
          },
        });
        await tx.equipment.update({ where: { id: current.id }, data: { status: "OUT_OF_SERVICE" } });
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: current.branchId,
            actorUserId: session.user.id,
            action: "EQUIPMENT_DOWNTIME_OPENED",
            entityType: "EquipmentDowntime",
            entityId: created.id,
            newValues: { equipmentId: current.id, reason, impact: created.impact, startedAt: created.startedAt },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
        return { action, downtime: created };
      }

      if (action === "CLOSE") {
        if (!open) throw new Error("NO_OPEN_DOWNTIME");
        const claimed = await tx.equipmentDowntime.updateMany({
          where: { id: open.id, equipmentId: current.id, status: "OPEN" },
          data: { status: "CLOSED", endedAt: now, resolution },
        });
        if (claimed.count !== 1) throw new Error("DOWNTIME_ALREADY_CLOSED");
        // Closing a ticket is not proof of calibration or equipment fitness.
        // Keep OUT_OF_SERVICE until an explicit guarded RESTORE action.
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: current.branchId,
            actorUserId: session.user.id,
            action: "EQUIPMENT_DOWNTIME_CLOSED",
            entityType: "EquipmentDowntime",
            entityId: open.id,
            oldValues: { status: "OPEN" },
            newValues: { status: "CLOSED", endedAt: now, resolution, equipmentStatus: current.status },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
        return { action, downtime: await tx.equipmentDowntime.findUniqueOrThrow({ where: { id: open.id } }) };
      }

      if (open) throw new Error("DOWNTIME_STILL_OPEN");
      if (current.status !== "OUT_OF_SERVICE") throw new Error("EQUIPMENT_NOT_OUT_OF_SERVICE");
      const calibration = current.calibrationEvents[0];
      if (calibration && (
        calibration.status !== "PASS" || !calibration.approvedAt ||
        (calibration.dueAt && calibration.dueAt <= now)
      )) throw new Error("CALIBRATION_NOT_CLEARED");
      if (current.maintenanceEvents.length > 0 || current.maintenancePlans.length > 0) {
        throw new Error("MAINTENANCE_NOT_CLEARED");
      }
      const restored = await tx.equipment.updateMany({
        where: { id: current.id, status: "OUT_OF_SERVICE" },
        data: { status: "ACTIVE" },
      });
      if (restored.count !== 1) throw new Error("EQUIPMENT_STATE_CHANGED");
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: current.branchId,
          actorUserId: session.user.id,
          action: "EQUIPMENT_RETURNED_TO_SERVICE",
          entityType: "Equipment",
          entityId: current.id,
          oldValues: { status: "OUT_OF_SERVICE" },
          newValues: { status: "ACTIVE", calibrationEventId: calibration?.id || null },
          reason: resolution,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return { action, equipmentId: current.id, equipmentStatus: "ACTIVE" };
    }, { isolationLevel: "Serializable", timeout: 30000 });
    return NextResponse.json({ status: "ok", ...result }, { status: action === "OPEN" ? 201 : 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const known = new Set([
      "EQUIPMENT_NOT_FOUND", "DOWNTIME_ALREADY_OPEN", "EQUIPMENT_INACTIVE",
      "NO_OPEN_DOWNTIME", "DOWNTIME_ALREADY_CLOSED", "DOWNTIME_STILL_OPEN",
      "EQUIPMENT_NOT_OUT_OF_SERVICE", "CALIBRATION_NOT_CLEARED",
      "MAINTENANCE_NOT_CLEARED", "EQUIPMENT_STATE_CHANGED",
    ]);
    return NextResponse.json({ error: known.has(message) ? message.toLowerCase() : "equipment_transition_conflict" }, { status: 409 });
  }
}
