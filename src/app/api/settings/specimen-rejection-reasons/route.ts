import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function rejectionCode(value: unknown) {
  const code = text(value, 80).toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return code && /^[A-Z0-9_]{2,80}$/.test(code) ? code : null;
}

export async function POST(request: Request) {
  const session = await requirePermission("settings.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const code = rejectionCode(body.code);
  const nameEn = text(body.nameEn, 180);
  const nameAr = text(body.nameAr, 180) || null;
  const sortOrder = Number(body.sortOrder ?? 0);
  if (!code || !nameEn || !Number.isInteger(sortOrder) || sortOrder < -10000 || sortOrder > 10000) {
    return NextResponse.json({ error: "invalid_rejection_reason" }, { status: 400 });
  }

  const existing = await prisma.specimenRejectionReason.findFirst({
    where: { organizationId: session.user.organizationId, code },
  });
  if (existing) return NextResponse.json({ error: "rejection_reason_code_exists" }, { status: 409 });

  const reason = await prisma.$transaction(async tx => {
    const created = await tx.specimenRejectionReason.create({
      data: {
        organizationId: session.user.organizationId,
        code,
        nameEn,
        nameAr,
        sortOrder,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        actorUserId: session.user.id,
        action: "SPECIMEN_REJECTION_REASON_CREATED",
        entityType: "SpecimenRejectionReason",
        entityId: created.id,
        newValues: { code, nameEn, nameAr, sortOrder, status: "ACTIVE" },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", reason }, { status: 201 });
}

export async function PATCH(request: Request) {
  const session = await requirePermission("settings.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const id = text(body.id, 36);
  const nameEn = text(body.nameEn, 180);
  const nameAr = text(body.nameAr, 180) || null;
  const sortOrder = Number(body.sortOrder ?? 0);
  const status = body.status === "INACTIVE" ? "INACTIVE" : body.status === "ACTIVE" ? "ACTIVE" : null;
  if (!id || !nameEn || !status || !Number.isInteger(sortOrder) || sortOrder < -10000 || sortOrder > 10000) {
    return NextResponse.json({ error: "invalid_rejection_reason" }, { status: 400 });
  }

  const current = await prisma.specimenRejectionReason.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!current) return NextResponse.json({ error: "rejection_reason_not_found" }, { status: 404 });

  const updated = await prisma.$transaction(async tx => {
    const saved = await tx.specimenRejectionReason.update({
      where: { id: current.id },
      data: {
        nameEn,
        nameAr,
        sortOrder,
        status,
        deactivatedAt: status === "INACTIVE" ? current.deactivatedAt || new Date() : null,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        actorUserId: session.user.id,
        action: "SPECIMEN_REJECTION_REASON_UPDATED",
        entityType: "SpecimenRejectionReason",
        entityId: current.id,
        oldValues: {
          nameEn: current.nameEn,
          nameAr: current.nameAr,
          sortOrder: current.sortOrder,
          status: current.status,
        },
        newValues: { nameEn, nameAr, sortOrder, status },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return saved;
  });

  return NextResponse.json({ status: "ok", reason: updated });
}
