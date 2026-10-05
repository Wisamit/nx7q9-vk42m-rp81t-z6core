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
  });
  if (!equipment) return NextResponse.json({ error: "equipment_not_found" }, { status: 404 });
  if (!canAccessBranch(session, equipment.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const documentType = text(body.documentType, 80).toUpperCase();
  const name = text(body.name, 255);
  const storageKey = text(body.storageKey, 500) || null;
  const externalUrl = text(body.externalUrl, 1000) || null;
  const notes = text(body.notes, 500) || null;

  if (!documentType || !name || (!storageKey && !externalUrl)) {
    return NextResponse.json({ error: "document_reference_required" }, { status: 400 });
  }
  if (externalUrl) {
    try {
      const parsed = new URL(externalUrl);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("invalid");
    } catch {
      return NextResponse.json({ error: "invalid_document_url" }, { status: 400 });
    }
  }

  let expiresAt: Date | null = null;
  if (body.expiresAt) {
    expiresAt = new Date(String(body.expiresAt));
    if (Number.isNaN(expiresAt.getTime())) return NextResponse.json({ error: "invalid_expiry_date" }, { status: 400 });
  }

  const document = await prisma.$transaction(async tx => {
    const created = await tx.equipmentDocument.create({
      data: {
        equipmentId: equipment.id,
        documentType,
        name,
        storageKey,
        externalUrl,
        expiresAt,
        notes,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: equipment.branchId,
        actorUserId: session.user.id,
        action: "EQUIPMENT_DOCUMENT_RECORDED",
        entityType: "EquipmentDocument",
        entityId: created.id,
        newValues: {
          equipmentId: equipment.id,
          documentType,
          name,
          storageKey,
          externalUrl,
          expiresAt,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", document }, { status: 201 });
}
