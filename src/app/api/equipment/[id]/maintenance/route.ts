import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function date(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_DATE");
  return parsed;
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
  if (!canAccessBranch(session, equipment.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const maintenanceType = ["PREVENTIVE","CORRECTIVE"].includes(body.maintenanceType) ? body.maintenanceType : null;
  const status = ["SCHEDULED","IN_PROGRESS","COMPLETED"].includes(body.status) ? body.status : "SCHEDULED";
  if (!maintenanceType) return NextResponse.json({ error: "maintenance_type_required" }, { status: 400 });

  let scheduledAt: Date | null;
  let startedAt: Date | null;
  let completedAt: Date | null;
  try {
    scheduledAt = date(body.scheduledAt);
    startedAt = date(body.startedAt);
    completedAt = date(body.completedAt);
  } catch {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  let cost: Prisma.Decimal | null = null;
  const currency = text(body.currency, 3).toUpperCase() || null;
  if (body.cost !== "" && body.cost != null) {
    const raw = String(body.cost).trim();
    if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) return NextResponse.json({ error: "invalid_cost" }, { status: 400 });
    cost = new Prisma.Decimal(raw);
    if (!currency || !/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "currency_required_for_cost" }, { status: 400 });
  }

  const event = await prisma.$transaction(async tx => {
    const created = await tx.maintenanceEvent.create({
      data: {
        equipmentId: equipment.id,
        analyzerId: equipment.analyzerId,
        maintenanceType,
        status,
        scheduledAt,
        startedAt,
        completedAt: status === "COMPLETED" ? completedAt || new Date() : completedAt,
        vendorEngineer: text(body.vendorEngineer, 220) || null,
        workPerformed: text(body.workPerformed) || null,
        correctiveAction: text(body.correctiveAction) || null,
        cost,
        currency: cost ? currency : null,
        performedByUserId: status === "COMPLETED" ? session.user.id : null,
      },
    });

    if (status === "IN_PROGRESS") {
      await tx.equipment.update({ where: { id: equipment.id }, data: { status: "UNDER_MAINTENANCE" } });
    } else if (status === "COMPLETED" && equipment.status === "UNDER_MAINTENANCE") {
      await tx.equipment.update({ where: { id: equipment.id }, data: { status: "ACTIVE" } });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: equipment.branchId,
        actorUserId: session.user.id,
        action: "EQUIPMENT_MAINTENANCE_RECORDED",
        entityType: "MaintenanceEvent",
        entityId: created.id,
        newValues: {
          equipmentId: equipment.id,
          maintenanceType,
          status,
          scheduledAt,
          startedAt,
          completedAt: created.completedAt,
          cost: cost?.toString() || null,
          currency: cost ? currency : null,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", event }, { status: 201 });
}
