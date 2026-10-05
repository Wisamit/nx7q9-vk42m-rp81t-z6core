import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 220) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function code(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

export async function POST(request: Request) {
  const session = await requirePermission("referrers.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const nameEn = text(body.nameEn);
  const nameAr = text(body.nameAr);
  const suppliedCode = text(body.code, 60);
  const type = ["PHYSICIAN","CLINIC","HOSPITAL","OTHER"].includes(body.type) ? body.type : "PHYSICIAN";
  const phone = text(body.phone, 50);
  const email = text(body.email, 191).toLowerCase();
  const licenseNumber = text(body.licenseNumber, 100);
  const clientId = text(body.clientId, 36) || null;

  if (!nameEn) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (clientId) {
    const validClient = await prisma.client.findFirst({ where: { id: clientId, organizationId: session.user.organizationId }, select: { id: true } });
    if (!validClient) return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }

  const referrerCode = code(suppliedCode || nameEn);
  if (!referrerCode) return NextResponse.json({ error: "code_required" }, { status: 400 });

  try {
    const referrer = await prisma.$transaction(async (tx) => {
      const created = await tx.referrer.create({
        data: {
          organizationId: session.user.organizationId,
          clientId,
          code: referrerCode,
          type,
          nameEn,
          nameAr: nameAr || null,
          phone: phone || null,
          email: email || null,
          licenseNumber: licenseNumber || null,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "REFERRER_CREATED",
          entityType: "Referrer",
          entityId: created.id,
          newValues: { code: created.code, type: created.type, nameEn: created.nameEn, clientId: created.clientId },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", referrer }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "referrer_code_already_exists" }, { status: 409 });
  }
}
