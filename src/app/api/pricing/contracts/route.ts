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
  const session = await requirePermission("pricing.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const clientId = text(body.clientId, 36);
  const nameEn = text(body.nameEn);
  const nameAr = text(body.nameAr);
  const suppliedCode = text(body.code, 60);
  const currency = text(body.currency, 3).toUpperCase();
  const effectiveFromText = text(body.effectiveFrom, 30);
  const effectiveToText = text(body.effectiveTo, 30);

  if (!clientId || !nameEn || currency.length !== 3 || !effectiveFromText) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const effectiveFrom = new Date(effectiveFromText);
  const effectiveTo = effectiveToText ? new Date(effectiveToText) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && Number.isNaN(effectiveTo.getTime())) || (effectiveTo && effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const client = await prisma.client.findFirst({
    where: { id: clientId, organizationId: session.user.organizationId, status: "ACTIVE" },
    select: { id: true },
  });
  if (!client) return NextResponse.json({ error: "client_not_found" }, { status: 404 });

  const contractCode = code(suppliedCode || nameEn);
  if (!contractCode) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  try {
    const contract = await prisma.$transaction(async (tx) => {
      const created = await tx.contract.create({
        data: {
          organizationId: session.user.organizationId,
          clientId,
          code: contractCode,
          nameEn,
          nameAr: nameAr || null,
          currency,
          effectiveFrom,
          effectiveTo,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "CONTRACT_CREATED",
          entityType: "Contract",
          entityId: created.id,
          newValues: {
            code: created.code,
            clientId: created.clientId,
            currency: created.currency,
            effectiveFrom: created.effectiveFrom,
            effectiveTo: created.effectiveTo,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return created;
    });

    return NextResponse.json({ status: "ok", contract }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "contract_code_already_exists" }, { status: 409 });
  }
}
