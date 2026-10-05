import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 220) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("pricing.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const priceListId = text(body.priceListId, 36);
  const packageId = text(body.packageId, 36);
  const amount = Number(body.unitPrice);
  const effectiveFromText = text(body.effectiveFrom, 30);
  const effectiveToText = text(body.effectiveTo, 30);

  if (!priceListId || !packageId || !Number.isFinite(amount) || amount < 0 || !effectiveFromText) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  const effectiveFrom = new Date(effectiveFromText);
  const effectiveTo = effectiveToText ? new Date(effectiveToText) : null;
  if (Number.isNaN(effectiveFrom.getTime()) || (effectiveTo && Number.isNaN(effectiveTo.getTime())) || (effectiveTo && effectiveTo < effectiveFrom)) {
    return NextResponse.json({ error: "invalid_effective_dates" }, { status: 400 });
  }

  const [priceList, pkg] = await Promise.all([
    prisma.priceList.findFirst({
      where: { id: priceListId, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, currency: true },
    }),
    prisma.commercialPackage.findFirst({
      where: { id: packageId, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, nameEn: true },
    }),
  ]);
  if (!priceList || !pkg) return NextResponse.json({ error: "master_data_not_found" }, { status: 404 });

  try {
    const created = await prisma.$transaction(async tx => {
      const item = await tx.priceListPackageItem.create({
        data: {
          priceListId,
          packageId,
          unitPrice: amount.toFixed(4),
          effectiveFrom,
          effectiveTo,
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "PACKAGE_PRICE_CREATED",
          entityType: "PriceListPackageItem",
          entityId: item.id,
          newValues: {
            priceListId,
            packageId,
            packageCode: pkg.code,
            unitPrice: amount.toFixed(4),
            currency: priceList.currency,
            effectiveFrom,
            effectiveTo,
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return item;
    });

    return NextResponse.json({ status: "ok", item: created }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "package_price_conflict" }, { status: 409 });
  }
}
