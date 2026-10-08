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

  const nameEn = text(body.nameEn);
  const nameAr = text(body.nameAr);
  const suppliedCode = text(body.code, 60);
  const scopeType = ["ORGANIZATION","BRANCH","SOURCE","REFERRER","CLIENT","CONTRACT"].includes(body.scopeType) ? body.scopeType : "ORGANIZATION";
  const currency = text(body.currency, 3).toUpperCase();
  const priority = Number.isInteger(body.priority) ? body.priority : Number(body.priority || 0);
  const branchId = text(body.branchId, 36) || null;
  const sourceId = text(body.sourceId, 36) || null;
  const referrerId = text(body.referrerId, 36) || null;
  const clientId = text(body.clientId, 36) || null;
  const contractId = text(body.contractId, 36) || null;
  const effectiveFromText = text(body.effectiveFrom, 30);
  const effectiveToText = text(body.effectiveTo, 30);

  if (!nameEn || !currency || currency.length !== 3 || !effectiveFromText) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }

  const effectiveFrom = new Date(effectiveFromText);
  const effectiveTo = effectiveToText ? new Date(effectiveToText) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && Number.isNaN(effectiveTo.getTime())) || (effectiveTo && effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  if (scopeType === "BRANCH" && !branchId) return NextResponse.json({ error: "branch_required" }, { status: 400 });
  if (scopeType === "SOURCE" && !sourceId) return NextResponse.json({ error: "source_required" }, { status: 400 });
  if (scopeType === "REFERRER" && !referrerId) return NextResponse.json({ error: "referrer_required" }, { status: 400 });
  if (scopeType === "CLIENT" && !clientId) return NextResponse.json({ error: "client_required" }, { status: 400 });
  if (scopeType === "CONTRACT" && !contractId) return NextResponse.json({ error: "contract_required" }, { status: 400 });

  if (branchId && !session.user.branchScopes.some((x) => x.branchId === branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (sourceId) {
    const source = await prisma.orderSource.findFirst({ where: { id: sourceId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true } });
    if (!source) return NextResponse.json({ error: "source_not_found" }, { status: 404 });
  }
  if (referrerId) {
    const referrer = await prisma.referrer.findFirst({ where: { id: referrerId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true } });
    if (!referrer) return NextResponse.json({ error: "referrer_not_found" }, { status: 404 });
  }
  if (clientId) {
    const client = await prisma.client.findFirst({ where: { id: clientId, organizationId: session.user.organizationId }, select: { id: true } });
    if (!client) return NextResponse.json({ error: "client_not_found" }, { status: 404 });
  }
  if (contractId) {
    const contract = await prisma.contract.findFirst({ where: { id: contractId, organizationId: session.user.organizationId }, select: { id: true } });
    if (!contract) return NextResponse.json({ error: "contract_not_found" }, { status: 404 });
  }

  const priceListCode = code(suppliedCode || nameEn);
  if (!priceListCode) return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  const normalizedPriority = Number.isFinite(priority) ? Math.trunc(priority) : 0;

  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${session.user.organizationId} FOR UPDATE`;

      const overlapping = await tx.priceList.findFirst({
        where: {
          organizationId: session.user.organizationId,
          status: "ACTIVE",
          scopeType,
          priority: normalizedPriority,
          branchId: scopeType === "BRANCH" ? branchId : null,
          sourceId: scopeType === "SOURCE" ? sourceId : null,
          referrerId: scopeType === "REFERRER" ? referrerId : null,
          clientId: scopeType === "CLIENT" ? clientId : null,
          contractId: scopeType === "CONTRACT" ? contractId : null,
          effectiveFrom,
        },
        select: { id: true, code: true },
      });
      if (overlapping) throw new Error("PRICE_LIST_PRECEDENCE_CONFLICT");

      const priceList = await tx.priceList.create({
        data: {
          organizationId: session.user.organizationId,
          code: priceListCode,
          nameEn,
          nameAr: nameAr || null,
          scopeType,
          branchId: scopeType === "BRANCH" ? branchId : null,
          sourceId: scopeType === "SOURCE" ? sourceId : null,
          referrerId: scopeType === "REFERRER" ? referrerId : null,
          clientId: scopeType === "CLIENT" ? clientId : null,
          contractId: scopeType === "CONTRACT" ? contractId : null,
          currency,
          priority: normalizedPriority,
          effectiveFrom,
          effectiveTo,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "PRICE_LIST_CREATED",
          entityType: "PriceList",
          entityId: priceList.id,
          newValues: { code: priceList.code, scopeType: priceList.scopeType, branchId: priceList.branchId, sourceId: priceList.sourceId, referrerId: priceList.referrerId, clientId: priceList.clientId, contractId: priceList.contractId, currency: priceList.currency, priority: priceList.priority, effectiveFrom: priceList.effectiveFrom, effectiveTo: priceList.effectiveTo },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return priceList;
    });
    return NextResponse.json({ status: "ok", priceList: created }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PRICE_LIST_PRECEDENCE_CONFLICT") {
      return NextResponse.json({ error: "price_list_precedence_conflict" }, { status: 409 });
    }
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "price_list_code_already_exists" }, { status: 409 });
    }
    throw error;
  }
}
