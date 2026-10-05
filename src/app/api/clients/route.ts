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
  const session = await requirePermission("clients.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const nameEn = text(body.nameEn);
  const nameAr = text(body.nameAr);
  const suppliedCode = text(body.code, 60);
  const type = ["INDIVIDUAL","CLINIC","HOSPITAL","COMPANY","INSURANCE","OTHER"].includes(body.type) ? body.type : "OTHER";
  const phone = text(body.phone, 50);
  const email = text(body.email, 191).toLowerCase();
  const paymentTermsDays = body.paymentTermsDays === "" || body.paymentTermsDays == null ? null : Number(body.paymentTermsDays);

  if (!nameEn) return NextResponse.json({ error: "name_required" }, { status: 400 });
  if (paymentTermsDays !== null && (!Number.isInteger(paymentTermsDays) || paymentTermsDays < 0 || paymentTermsDays > 3650)) {
    return NextResponse.json({ error: "invalid_payment_terms" }, { status: 400 });
  }

  const clientCode = code(suppliedCode || nameEn);
  if (!clientCode) return NextResponse.json({ error: "code_required" }, { status: 400 });

  try {
    const client = await prisma.$transaction(async (tx) => {
      const created = await tx.client.create({
        data: {
          organizationId: session.user.organizationId,
          code: clientCode,
          type,
          nameEn,
          nameAr: nameAr || null,
          phone: phone || null,
          email: email || null,
          paymentTermsDays,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "CLIENT_CREATED",
          entityType: "Client",
          entityId: created.id,
          newValues: { code: created.code, type: created.type, nameEn: created.nameEn },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", client }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "client_code_already_exists" }, { status: 409 });
  }
}
