import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("inventory.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const code = text(body.code, 80).toUpperCase();
  const nameEn = text(body.nameEn, 220);
  const nameAr = text(body.nameAr, 220) || null;
  if (!code || !nameEn) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });

  try {
    const supplier = await prisma.$transaction(async tx => {
      const created = await tx.supplier.create({
        data: {
          organizationId: session.user.organizationId,
          code,
          nameEn,
          nameAr,
          phone: text(body.phone, 50) || null,
          email: text(body.email, 191).toLowerCase() || null,
          address: text(body.address, 2000) || null,
          taxNumber: text(body.taxNumber, 100) || null,
          paymentTerms: text(body.paymentTerms, 500) || null,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "SUPPLIER_CREATED",
          entityType: "Supplier",
          entityId: created.id,
          newValues: { code, nameEn, nameAr: created.nameAr },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", supplier }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "supplier_create_failed" }, { status: 409 });
  }
}
