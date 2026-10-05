import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("qc.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const code = text(body.code, 80).toUpperCase();
  const nameEn = text(body.nameEn, 220);
  const levelName = text(body.levelName, 100);
  if (!code || !nameEn || !levelName) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });

  try {
    const material = await prisma.$transaction(async tx => {
      const created = await tx.qcMaterial.create({
        data: {
          organizationId: session.user.organizationId,
          code,
          nameEn,
          nameAr: text(body.nameAr, 220) || null,
          manufacturer: text(body.manufacturer, 150) || null,
          levelName,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "QC_MATERIAL_CREATED",
          entityType: "QcMaterial",
          entityId: created.id,
          newValues: { code, nameEn, levelName, manufacturer: created.manufacturer },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", material }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "qc_material_create_failed" }, { status: 409 });
  }
}
