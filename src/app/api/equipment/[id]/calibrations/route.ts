import { NextResponse } from "next/server";
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

  const status = ["DUE","IN_PROGRESS","PASS","FAIL"].includes(body.status) ? body.status : null;
  if (!status) return NextResponse.json({ error: "invalid_calibration_status" }, { status: 400 });

  let dueAt: Date | null;
  let performedAt: Date | null;
  try {
    dueAt = date(body.dueAt);
    performedAt = date(body.performedAt);
  } catch {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  const calibration = await prisma.$transaction(async tx => {
    const created = await tx.calibrationEvent.create({
      data: {
        equipmentId: equipment.id,
        analyzerId: equipment.analyzerId,
        materialName: text(body.materialName, 220) || null,
        materialLot: text(body.materialLot, 120) || null,
        dueAt,
        performedAt: ["PASS","FAIL"].includes(status) ? performedAt || new Date() : performedAt,
        resultSummary: text(body.resultSummary) || null,
        status,
        performedByUserId: ["PASS","FAIL"].includes(status) ? session.user.id : null,
        approvedByUserId: status === "PASS" && body.approve === true ? session.user.id : null,
        approvedAt: status === "PASS" && body.approve === true ? new Date() : null,
      },
    });

    if (status === "FAIL") {
      await tx.equipment.update({ where: { id: equipment.id }, data: { status: "OUT_OF_SERVICE" } });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: equipment.branchId,
        actorUserId: session.user.id,
        action: "EQUIPMENT_CALIBRATION_RECORDED",
        entityType: "CalibrationEvent",
        entityId: created.id,
        newValues: {
          equipmentId: equipment.id,
          analyzerId: equipment.analyzerId,
          status,
          dueAt,
          performedAt: created.performedAt,
          approvedAt: created.approvedAt,
          materialLot: created.materialLot,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", calibration }, { status: 201 });
}
