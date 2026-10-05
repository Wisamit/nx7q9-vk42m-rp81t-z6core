import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
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
  });
  if (!equipment) return NextResponse.json({ error: "equipment_not_found" }, { status: 404 });
  if (!canAccessBranch(session, equipment.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const name = text(body.name, 220);
  const frequencyDays = Number(body.frequencyDays);
  const nextDueAt = new Date(String(body.nextDueAt || ""));
  if (!name || !Number.isInteger(frequencyDays) || frequencyDays < 1 || frequencyDays > 3650 || Number.isNaN(nextDueAt.getTime())) {
    return NextResponse.json({ error: "invalid_maintenance_plan" }, { status: 400 });
  }

  const plan = await prisma.$transaction(async tx => {
    const created = await tx.maintenancePlan.create({
      data: {
        equipmentId: equipment.id,
        name,
        frequencyDays,
        nextDueAt,
        instructions: text(body.instructions) || null,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: equipment.branchId,
        actorUserId: session.user.id,
        action: "MAINTENANCE_PLAN_CREATED",
        entityType: "MaintenancePlan",
        entityId: created.id,
        newValues: {
          equipmentId: equipment.id,
          name,
          frequencyDays,
          nextDueAt,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", plan }, { status: 201 });
}
