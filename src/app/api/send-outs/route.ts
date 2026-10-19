import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseBranchExpectedInstant } from "@/lib/branch-wall-clock";
import { parseSendOutCost } from "@/lib/sendout-cost";
import { Prisma } from "../../../../../generated/prisma/client";

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

  const cost = parseSendOutCost(body.costAmount, body.costCurrency);
  if (cost.kind !== "ok") {
    return NextResponse.json({ error: "cost_and_currency_must_be_provided_together" }, { status: 400 });
  }
  const expectedResultAtText = text(body.expectedResultAt, 40);
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" },
    select: { timezone: true },
  });
  if (!branch) return NextResponse.json({ error: "branch_not_available" }, { status: 403 });
  const expectedResultAt = expectedResultAtText
    ? parseBranchExpectedInstant(expectedResultAtText, branch.timezone)
    : null;
  if (expectedResultAtText && !expectedResultAt) {
    return NextResponse.json({ error: "invalid_or_ambiguous_branch_local_time" }, { status: 400 });
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
  const selectedSpecimen = specimenId
    ? orderItem.specimenLinks.find(link => link.specimenId === specimenId)?.specimen || null
    : null;
  if (selectedSpecimen && !["COLLECTED","RECEIVED","IN_PROCESS"].includes(selectedSpecimen.status)) {
    return NextResponse.json({ error: "specimen_not_ready_for_sendout", status: selectedSpecimen.status }, { status: 409 });
  }
  const active = await prisma.sendOutReferral.findFirst({
    where: { orderItemId, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    select: { id: true },
  });
  if (active) return NextResponse.json({ error: "active_sendout_exists", referralId: active.id }, { status: 409 });

  const created = await prisma.$transaction(async tx => {
    if (selectedSpecimen && selectedSpecimen.status !== "IN_PROCESS") {
      const claimed = await tx.specimen.updateMany({
        where: {
          id: selectedSpecimen.id,
          status: selectedSpecimen.status,
          preanalyticalVersion: selectedSpecimen.preanalyticalVersion,
          orderItems: { some: { orderItemId, status: "ACTIVE" } },
        },
        data: { preanalyticalVersion: { increment: 1 } },
      });
      if (claimed.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");
    }

    const referral = await tx.sendOutReferral.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        orderItemId,
        specimenId,
        externalLaboratoryId,
        externalAccession: text(body.externalAccession, 120) || null,
        costAmount: cost.amount === null ? null : new Prisma.Decimal(cost.amount).toFixed(4),
        costCurrency: cost.currency,
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
          costCurrency: cost.currency,
          expectedResultAt,
        },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return referral;
  }).catch(error => {
    if (error instanceof Error && error.message === "SPECIMEN_PREANALYTICAL_STATE_CHANGED") return null;
    throw error;
  });

  if (!created) {
    return NextResponse.json({ error: "specimen_preanalytical_state_changed" }, { status: 409 });
  }
  return NextResponse.json({ status: "ok", referral: created }, { status: 201 });
}
