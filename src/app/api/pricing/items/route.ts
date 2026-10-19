import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { planNextPriceRevision } from "@/lib/pricing-version-governance";
import { normalizeLiveTariffPrice } from "@/lib/pricing-exact-money";

function text(value: unknown, max = 220) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("pricing.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const priceListId = text(body.priceListId, 36);
  const testId = text(body.testId, 36);
  const amount = normalizeLiveTariffPrice(body.unitPrice);
  const effectiveFromText = text(body.effectiveFrom, 30);
  const effectiveToText = text(body.effectiveTo, 30);

  if (!priceListId || !testId || amount === null || !effectiveFromText) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  const effectiveFrom = new Date(effectiveFromText);
  const effectiveTo = effectiveToText ? new Date(effectiveToText) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && Number.isNaN(effectiveTo.getTime())) || (effectiveTo && effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const [priceList, test] = await Promise.all([
    prisma.priceList.findFirst({
      where: { id: priceListId, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, branchId: true, currency: true },
    }),
    prisma.labTest.findFirst({
      where: { id: testId, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
    }),
  ]);
  if (!priceList || !test) return NextResponse.json({ error: "master_data_not_found" }, { status: 404 });
  if (priceList.branchId && !session.user.branchScopes.some(scope => scope.branchId === priceList.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM price_lists WHERE id = ${priceListId} FOR UPDATE`;

      const existing = await tx.priceListItem.findMany({
        where: { priceListId, testId },
        select: { id: true, status: true, effectiveFrom: true, effectiveTo: true },
        orderBy: [{ effectiveFrom: "asc" }, { id: "asc" }],
      });
      const plan = planNextPriceRevision(existing, effectiveFrom);
      if (!plan.ok) throw new Error(plan.error);

      const item = await tx.priceListItem.create({
        data: {
          priceListId,
          testId,
          unitPrice: amount,
          effectiveFrom,
          effectiveTo,
        },
      });

      const predecessors = existing.filter(revision => plan.predecessorIdsToClose.includes(revision.id));
      for (const predecessor of predecessors) {
        await tx.priceListItem.update({
          where: { id: predecessor.id },
          data: { effectiveTo: plan.predecessorCloseAt },
        });
        await tx.auditEvent.create({
          data: {
            organizationId: session.user.organizationId,
            branchId: session.activeBranchId,
            actorUserId: session.user.id,
            action: "PRICE_LIST_ITEM_SUPERSEDED",
            entityType: "PriceListItem",
            entityId: predecessor.id,
            oldValues: { effectiveTo: predecessor.effectiveTo },
            newValues: {
              effectiveTo: plan.predecessorCloseAt,
              supersededByPriceListItemId: item.id,
              supersededByEffectiveFrom: effectiveFrom,
            },
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "PRICE_LIST_ITEM_CREATED",
          entityType: "PriceListItem",
          entityId: item.id,
          newValues: {
            priceListId,
            testId,
            testCode: test.code,
            unitPrice: amount,
            currency: priceList.currency,
            effectiveFrom,
            effectiveTo,
            supersededPriceListItemIds: plan.predecessorIdsToClose,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return { item, supersededCount: predecessors.length };
    });
    return NextResponse.json({ status: "ok", item: created.item, supersededCount: created.supersededCount }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "PRICE_REVISION_MUST_START_AFTER_LATEST") {
      return NextResponse.json({ error: "price_revision_must_start_after_latest" }, { status: 409 });
    }
    return NextResponse.json({ error: "price_item_conflict" }, { status: 409 });
  }
}
