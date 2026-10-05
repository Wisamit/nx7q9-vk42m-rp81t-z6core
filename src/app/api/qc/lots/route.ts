import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function date(value: unknown) {
  if (!value) return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) throw new Error("INVALID_DATE");
  return parsed;
}

export async function POST(request: Request) {
  const session = await requirePermission("qc.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const materialId = text(body.materialId, 36);
  const inventoryLotId = text(body.inventoryLotId, 36) || null;
  const lotNumber = text(body.lotNumber, 120).toUpperCase();
  if (!materialId || !lotNumber) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });

  let receivedAt: Date | null;
  let openedAt: Date | null;
  let expiryDate: Date | null;
  try {
    receivedAt = date(body.receivedAt);
    openedAt = date(body.openedAt);
    expiryDate = date(body.expiryDate);
  } catch {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }

  const [material, inventoryLot] = await Promise.all([
    prisma.qcMaterial.findFirst({ where: { id: materialId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    inventoryLotId
      ? prisma.inventoryLot.findFirst({
          where: {
            id: inventoryLotId,
            organizationId: session.user.organizationId,
            status: "ACTIVE",
            item: { itemType: "CONTROL" },
          },
        })
      : Promise.resolve(null),
  ]);
  if (!material) return NextResponse.json({ error: "qc_material_not_found" }, { status: 404 });
  if (inventoryLotId && !inventoryLot) return NextResponse.json({ error: "control_inventory_lot_not_found" }, { status: 404 });
  if (inventoryLot && inventoryLot.lotNumber.toUpperCase() !== lotNumber) {
    return NextResponse.json({ error: "inventory_qc_lot_number_mismatch" }, { status: 409 });
  }

  try {
    const lot = await prisma.$transaction(async tx => {
      const created = await tx.qcLot.create({
        data: {
          organizationId: session.user.organizationId,
          materialId,
          inventoryLotId,
          lotNumber,
          receivedAt: receivedAt || inventoryLot?.receivedDate || null,
          openedAt,
          expiryDate: expiryDate || inventoryLot?.expiryDate || null,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "QC_LOT_CREATED",
          entityType: "QcLot",
          entityId: created.id,
          newValues: { materialId, inventoryLotId, lotNumber, receivedAt: created.receivedAt, openedAt, expiryDate: created.expiryDate },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", lot }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "qc_lot_create_failed" }, { status: 409 });
  }
}
