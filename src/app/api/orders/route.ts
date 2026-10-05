import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveTestPrice } from "@/lib/pricing";

function text(value: unknown, max = 500) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function uniqueIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((x): x is string => typeof x === "string" && x.length > 0))];
}

function documentNumber(prefix: string) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${date}-${randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function POST(request: Request) {
  const session = await requirePermission("orders.create");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36) || session.activeBranchId;
  const patientId = text(body.patientId, 36);
  const referrerId = text(body.referrerId, 36) || null;
  const clientId = text(body.clientId, 36) || null;
  const testIds = uniqueIds(body.testIds);
  const priority = ["ROUTINE", "URGENT", "STAT"].includes(body.priority) ? body.priority : "ROUTINE";
  const clinicalNotes = text(body.clinicalNotes, 5000);
  const diagnosis = text(body.diagnosis, 500);
  const pregnancyInfo = text(body.pregnancyInfo, 500);
  const fasting = body.fasting === true ? true : body.fasting === false ? false : null;

  if (!branchId || !patientId || testIds.length === 0) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const [patient, tests, referrer, client] = await Promise.all([
    prisma.patient.findFirst({ where: { id: patientId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true, patientNumber: true, fullNameEn: true } }),
    prisma.labTest.findMany({
      where: { id: { in: testIds }, organizationId: session.user.organizationId, status: "ACTIVE" },
      include: { defaultUnit: true },
    }),
    referrerId ? prisma.referrer.findFirst({ where: { id: referrerId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true, clientId: true } }) : null,
    clientId ? prisma.client.findFirst({ where: { id: clientId, organizationId: session.user.organizationId, status: "ACTIVE" }, select: { id: true } }) : null,
  ]);

  if (!patient) return NextResponse.json({ error: "patient_not_found" }, { status: 404 });
  if (tests.length !== testIds.length) return NextResponse.json({ error: "one_or_more_tests_not_found" }, { status: 404 });
  if (referrerId && !referrer) return NextResponse.json({ error: "referrer_not_found" }, { status: 404 });
  if (clientId && !client) return NextResponse.json({ error: "client_not_found" }, { status: 404 });

  const effectiveClientId = clientId || referrer?.clientId || null;

  const prices = await Promise.all(tests.map(async (test) => ({
    test,
    price: await resolveTestPrice(prisma, {
      organizationId: session.user.organizationId,
      branchId,
      clientId: effectiveClientId,
      testId: test.id,
    }),
  })));

  const missingPrices = prices.filter(x => !x.price).map(x => ({ id: x.test.id, code: x.test.code, name: x.test.nameEn }));
  if (missingPrices.length > 0) {
    return NextResponse.json({ error: "missing_prices", tests: missingPrices }, { status: 409 });
  }

  const currencies = [...new Set(prices.map(x => x.price!.currency))];
  if (currencies.length !== 1) {
    return NextResponse.json({ error: "mixed_currencies_not_allowed", currencies }, { status: 409 });
  }
  const currency = currencies[0];

  try {
    const result = await prisma.$transaction(async (tx) => {
      let accessionNumber = documentNumber("ORD");
      while (await tx.labOrder.findUnique({ where: { organizationId_accessionNumber: { organizationId: session.user.organizationId, accessionNumber } } })) {
        accessionNumber = documentNumber("ORD");
      }

      const order = await tx.labOrder.create({
        data: {
          organizationId: session.user.organizationId,
          accessionNumber,
          orderingBranchId: branchId,
          patientId,
          referrerId,
          clientId: effectiveClientId,
          priority,
          clinicalNotes: clinicalNotes || null,
          diagnosis: diagnosis || null,
          fasting,
          pregnancyInfo: pregnancyInfo || null,
          createdByUserId: session.user.id,
        },
      });

      await tx.orderStatusHistory.create({
        data: {
          orderId: order.id,
          fromStatus: null,
          toStatus: "REGISTERED",
          reason: "Initial order registration",
          changedByUserId: session.user.id,
        },
      });

      const createdItems = [];
      let subtotal = new Prisma.Decimal(0);

      for (const entry of prices) {
        const price = entry.price!;
        const unitPrice = new Prisma.Decimal(price.unitPrice);
        subtotal = subtotal.add(unitPrice);

        const item = await tx.orderItem.create({
          data: {
            orderId: order.id,
            testId: entry.test.id,
            performedBranchId: branchId,
            priceListItemId: price.priceListItemId,
            testCodeSnapshot: entry.test.code,
            testNameEnSnapshot: entry.test.nameEn,
            testNameArSnapshot: entry.test.nameAr,
            unitSnapshot: entry.test.defaultUnit?.symbol || null,
            unitPriceSnapshot: unitPrice,
            discountAmountSnapshot: new Prisma.Decimal(0),
            taxAmountSnapshot: new Prisma.Decimal(0),
            finalPriceSnapshot: unitPrice,
            currency,
          },
        });
        createdItems.push({ item, test: entry.test, unitPrice });
      }

      let invoiceNumber = documentNumber("INV");
      while (await tx.invoice.findUnique({ where: { organizationId_invoiceNumber: { organizationId: session.user.organizationId, invoiceNumber } } })) {
        invoiceNumber = documentNumber("INV");
      }

      const invoice = await tx.invoice.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          orderId: order.id,
          clientId: effectiveClientId,
          invoiceNumber,
          currency,
          subtotal,
          discountTotal: new Prisma.Decimal(0),
          taxTotal: new Prisma.Decimal(0),
          total: subtotal,
          paidAmount: new Prisma.Decimal(0),
          balanceAmount: subtotal,
          createdByUserId: session.user.id,
        },
      });

      for (const entry of createdItems) {
        await tx.invoiceLine.create({
          data: {
            invoiceId: invoice.id,
            orderItemId: entry.item.id,
            description: entry.test.nameEn,
            testCodeSnapshot: entry.test.code,
            testNameEnSnapshot: entry.test.nameEn,
            quantity: new Prisma.Decimal(1),
            unitPrice: entry.unitPrice,
            discountAmount: new Prisma.Decimal(0),
            taxAmount: new Prisma.Decimal(0),
            lineTotal: entry.unitPrice,
          },
        });
      }

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          actorUserId: session.user.id,
          action: "ORDER_REGISTERED",
          entityType: "LabOrder",
          entityId: order.id,
          newValues: {
            accessionNumber,
            patientId,
            referrerId,
            clientId: effectiveClientId,
            priority,
            testIds,
            invoiceNumber,
            currency,
            total: subtotal.toString(),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });

      return { order, invoice, total: subtotal.toString() };
    }, { timeout: 30000 });

    return NextResponse.json({
      status: "ok",
      orderId: result.order.id,
      accessionNumber: result.order.accessionNumber,
      invoiceId: result.invoice.id,
      invoiceNumber: result.invoice.invoiceNumber,
      currency,
      total: result.total,
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "order_creation_failed" }, { status: 500 });
  }
}
