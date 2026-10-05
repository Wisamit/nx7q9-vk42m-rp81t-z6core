import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("sendouts.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const code = text(body.code, 80).toUpperCase();
  const nameEn = text(body.nameEn, 220);
  if (!code || !nameEn) return NextResponse.json({ error: "code_and_name_required" }, { status: 400 });

  try {
    const lab = await prisma.$transaction(async tx => {
      const created = await tx.externalLaboratory.create({
        data: {
          organizationId: session.user.organizationId,
          code,
          nameEn,
          nameAr: text(body.nameAr, 220) || null,
          phone: text(body.phone, 80) || null,
          email: text(body.email, 191) || null,
          address: text(body.address, 5000) || null,
          notes: text(body.notes, 5000) || null,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "EXTERNAL_LAB_CREATED",
          entityType: "ExternalLaboratory",
          entityId: created.id,
          newValues: { code, nameEn },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", laboratory: lab }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "external_lab_code_exists" }, { status: 409 });
  }
}
