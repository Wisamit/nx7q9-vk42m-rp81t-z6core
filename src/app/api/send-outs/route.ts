import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("sendouts.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36);
  const orderItemId = text(body.orderItemId, 36);
  const specimenId = text(body.specimenId, 36) || null;
  const externalLaboratoryId = text(body.externalLaboratoryId, 36);
  if (!branchId || !orderItemId || !externalLaboratoryId) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const costText = body.costAmount === null || body.costAmount === undefined || body.costAmount === "" ? "" : String(body.costAmount);
  const costAmount = costText ? Number(costText) : null;
  const costCurrency = text(body.costCurrency, 3).toUpperCase() || null;
  if ((costAmount !== null && (!Number.isFinite(costAmount) || costAmount < 0)) || ((costAmount !== null) !== Boolean(costCurrency))) {
    return NextResponse.json({ error: "cost_and_currency_must_be_provided_together" }, { status: 400 });
  }
  const expectedResultAtText = text(body.expectedResultAt, 40);
  const expectedResultAt = expectedResultAtText ? new Date(expectedResultAtText) : null;
  if (expectedResultAt && Number.isNaN(expectedResultAt.getTime())) {
    return NextResponse.json({ error: "invalid_expected_result_at" }, { status: 400 });
  }

  const [orderItem, laboratory] = await Promise.all([
    prisma.orderItem.findFirst({
      where: { id: orderItemId, order: { organizationId: session.user.organizationId } },
      include: {
        order: { select: { orderingBranchId: true, accessionNumber: true } },
        specimenLinks: { where: { status: "ACTIVE" }, include: { specimen: true } },
      },
    }),
    prisma.externalLaboratory.findFirst({
      where: { id: externalLaboratoryId, organizationId: session.user.organizationId, status: "ACTIVE" },
    }),
  ]);
  if (!orderItem || !laboratory) return NextResponse.json({ error: "master_data_not_found" }, { status: 404 });
  if (!canAccessBranch(session, orderItem.order.orderingBranchId)) return NextResponse.json({ error: "order_branch_forbidden" }, { status: 403 });
  if (specimenId && !orderItem.specimenLinks.some(link => link.specimenId === specimenId)) {
    return NextResponse.json({ error: "specimen_not_linked_to_order_item" }, { status: 409 });
  }
  const active = await prisma.sendOutReferral.findFirst({
    where: { orderItemId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: { id: true },
  });
  if (active) return NextResponse.json({ error: "active_sendout_exists", referralId: active.id }, { status: 409 });

  const created = await prisma.$transaction(async tx => {
    const referral = await tx.sendOutReferral.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        orderItemId,
        specimenId,
        externalLaboratoryId,
        externalAccession: text(body.externalAccession, 120) || null,
        costAmount: costAmount === null ? null : costAmount.toFixed(4),
        costCurrency,
        expectedResultAt,
        createdByUserId: session.user.id,
      },
    });
    await tx.sendOutEvent.create({
      data: {
        referralId: referral.id,
        toStatus: "CREATED",
        actorUserId: session.user.id,
        note: text(body.note, 1000) || null,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        actorUserId: session.user.id,
        action: "SEND_OUT_CREATED",
        entityType: "SendOutReferral",
        entityId: referral.id,
        newValues: {
          accessionNumber: orderItem.order.accessionNumber,
          orderItemId,
          specimenId,
          externalLaboratoryId,
          externalLaboratoryCode: laboratory.code,
          externalAccession: referral.externalAccession,
          costAmount: referral.costAmount?.toString() || null,
          costCurrency,
          expectedResultAt,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return referral;
  });

  return NextResponse.json({ status: "ok", referral: created }, { status: 201 });
}
