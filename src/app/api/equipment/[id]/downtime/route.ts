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

  if (body.action === "OPEN") {
    const reason = text(body.reason);
    if (!reason) return NextResponse.json({ error: "downtime_reason_required" }, { status: 400 });
    if (equipment.downtimeEvents.length > 0) return NextResponse.json({ error: "downtime_already_open" }, { status: 409 });

    const downtime = await prisma.$transaction(async tx => {
      const created = await tx.equipmentDowntime.create({
        data: {
          equipmentId: equipment.id,
          analyzerId: equipment.analyzerId,
          startedAt: new Date(),
          reason,
          impact: text(body.impact) || null,
        },
      });
      await tx.equipment.update({ where: { id: equipment.id }, data: { status: "OUT_OF_SERVICE" } });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: equipment.branchId,
          actorUserId: session.user.id,
          action: "EQUIPMENT_DOWNTIME_OPENED",
          entityType: "EquipmentDowntime",
          entityId: created.id,
          newValues: { equipmentId: equipment.id, reason, impact: created.impact, startedAt: created.startedAt },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", downtime }, { status: 201 });
  }

  if (body.action === "CLOSE") {
    const open = equipment.downtimeEvents[0];
    if (!open) return NextResponse.json({ error: "no_open_downtime" }, { status: 409 });
    const resolution = text(body.resolution);
    if (!resolution) return NextResponse.json({ error: "resolution_required" }, { status: 400 });
    const endedAt = new Date();

    const downtime = await prisma.$transaction(async tx => {
      const updated = await tx.equipmentDowntime.update({
        where: { id: open.id },
        data: { status: "CLOSED", endedAt, resolution },
      });
      await tx.equipment.update({ where: { id: equipment.id }, data: { status: "ACTIVE" } });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: equipment.branchId,
          actorUserId: session.user.id,
          action: "EQUIPMENT_DOWNTIME_CLOSED",
          entityType: "EquipmentDowntime",
          entityId: open.id,
          oldValues: { status: "OPEN" },
          newValues: { status: "CLOSED", endedAt, resolution },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return updated;
    });
    return NextResponse.json({ status: "ok", downtime });
  }

  return NextResponse.json({ error: "invalid_action" }, { status: 400 });
}
