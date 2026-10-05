import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 220) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("inventory.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const code = text(body.code, 80).toUpperCase();
  const nameEn = text(body.nameEn);
  const nameAr = text(body.nameAr) || null;
  if (!code || !nameEn) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });

  try {
    const category = await prisma.$transaction(async tx => {
      const created = await tx.inventoryCategory.create({
        data: { organizationId: session.user.organizationId, code, nameEn, nameAr },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "INVENTORY_CATEGORY_CREATED",
          entityType: "InventoryCategory",
          entityId: created.id,
          newValues: { code, nameEn, nameAr },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", category }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "inventory_category_create_failed" }, { status: 409 });
  }
}
