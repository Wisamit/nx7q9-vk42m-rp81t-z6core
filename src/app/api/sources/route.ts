import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 220) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("sources.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const code = text(body.code, 60).toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
  const category = text(body.category, 80).toUpperCase().replace(/[^A-Z0-9_-]/g, "_");
  const nameEn = text(body.nameEn);
  const nameAr = text(body.nameAr) || null;
  if (!code || !category || !nameEn) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const source = await prisma.$transaction(async tx => {
    const created = await tx.orderSource.create({
      data: {
        organizationId: session.user.organizationId,
        code,
        category,
        nameEn,
        nameAr,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "ORDER_SOURCE_CREATED",
        entityType: "OrderSource",
        entityId: created.id,
        newValues: { code, category, nameEn, nameAr },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", source }, { status: 201 });
}
