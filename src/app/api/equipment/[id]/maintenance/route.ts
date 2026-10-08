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
  const maintenancePlanId = text(body.maintenancePlanId, 36) || null;
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

  const maintenancePlan = maintenancePlanId
    ? await prisma.maintenancePlan.findFirst({
        where: {
          id: maintenancePlanId,
          equipmentId: equipment.id,
          status: "ACTIVE",
        },
      })
    : null;
  if (maintenancePlanId && !maintenancePlan) {
    return NextResponse.json({ error: "maintenance_plan_not_found" }, { status: 404 });
  }
  if (maintenancePlan && maintenanceType !== "PREVENTIVE") {
    return NextResponse.json({ error: "maintenance_plan_requires_preventive_type" }, { status: 409 });
  }

  let cost: Prisma.Decimal | null = null;
  const currency = text(body.currency, 3).toUpperCase() || null;
  if (body.cost !== "" && body.cost != null) {
    const raw = String(body.cost).trim();
    if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) return NextResponse.json({ error: "invalid_cost" }, { status: 400 });
    cost = new Prisma.Decimal(raw);
    if (!currency || !/^[A-Z]{3}$/.test(currency)) return NextResponse.json({ error: "currency_required_for_cost" }, { status: 400 });
  }

  let event;
  try {
    event = await prisma.$transaction(async tx => {
      // Share the equipment row lock with downtime and RESTORE transitions.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM equipment WHERE id = ${equipment.id}
        AND organization_id = ${session.user.organizationId} FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("EQUIPMENT_NOT_FOUND");
      const current = await tx.equipment.findUniqueOrThrow({ where: { id: equipment.id } });
      if (current.status === "RETIRED") throw new Error("EQUIPMENT_RETIRED");
      if (maintenancePlanId) {
        const activePlan = await tx.maintenancePlan.findFirst({
          where: { id: maintenancePlanId, equipmentId: current.id, status: "ACTIVE" },
        });
        if (!activePlan) throw new Error("MAINTENANCE_PLAN_CHANGED");
      }
      const created = await tx.maintenanceEvent.create({
      data: {
        equipmentId: equipment.id,
        analyzerId: equipment.analyzerId,
        maintenancePlanId,
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

    if (status === "COMPLETED" && maintenancePlan) {
      const base = created.completedAt || new Date();
      const nextDueAt = new Date(base.getTime() + maintenancePlan.frequencyDays * 24 * 60 * 60_000);
      await tx.maintenancePlan.update({
        where: { id: maintenancePlan.id },
        data: { nextDueAt },
      });
    }

    if (status === "IN_PROGRESS" && current.status === "ACTIVE") {
      await tx.equipment.update({ where: { id: current.id }, data: { status: "UNDER_MAINTENANCE" } });
    } else if (status === "COMPLETED" && current.status === "UNDER_MAINTENANCE") {
      // Completion does not requalify an analyzer; require a separate guarded RESTORE.
      await tx.equipment.update({ where: { id: current.id }, data: { status: "OUT_OF_SERVICE" } });
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
          maintenancePlanId,
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
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    return NextResponse.json({
      error: ["EQUIPMENT_RETIRED", "MAINTENANCE_PLAN_CHANGED"].includes(reason)
        ? reason.toLowerCase() : "equipment_maintenance_conflict",
    }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", event }, { status: 201 });
}
