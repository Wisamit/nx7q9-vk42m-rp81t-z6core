import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseBranchExpectedInstant } from "@/lib/branch-wall-clock";
import { parseSendOutCost } from "@/lib/sendout-cost";
import { Prisma } from "../../../../generated/prisma/client";

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
  const outcome = await prisma.$transaction(async tx => {
    // Serialize independent dispatch requests for this SAME order item. The
    // pre-transaction lookup was race-prone: both writers could see no active
    // referral and create parallel send-outs. A locking read precedes the
    // authoritative active-referral check and every custody/audit write.
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM order_items WHERE id = ${orderItemId} FOR UPDATE
    `;
    if (locked.length !== 1) return { kind: "order_item_changed" } as const;
    // Recheck authoritative order/item eligibility under the item lock; a
    // candidate list rendered before cancellation is not a commit-time gate.
    const currentItem = await tx.orderItem.findFirst({
      where: { id: orderItemId, order: { organizationId: session.user.organizationId } },
      select: {
        orderId: true,
        status: true,
        order: { select: { status: true, orderingBranchId: true } },
      },
    });
    if (!currentItem ||
        ["CANCELLED", "VERIFIED"].includes(currentItem.status) ||
        ["CANCELLED", "COMPLETED"].includes(currentItem.order.status) ||
        !canAccessBranch(session, currentItem.order.orderingBranchId)) {
      return { kind: "order_item_changed" } as const;
    }
    const active = await tx.sendOutReferral.findFirst({
      where: {
        organizationId: session.user.organizationId,
        orderItemId,
        status: { notIn: ["COMPLETED", "CANCELLED"] },
      },
      select: { id: true },
    });
    if (active) return { kind: "active_exists", referralId: active.id } as const;
    if (specimenId) {
      // Lock current physical custody before writing the referral. A previous
      // candidate selection cannot authorize a transfer, rejection or an
      // unrelated branch/specimen discovered after this request began.
      const specimenLock = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM specimens WHERE id = ${specimenId} FOR UPDATE
      `;
      if (specimenLock.length !== 1) return { kind: "specimen_state_changed" } as const;
      const currentSpecimen = await tx.specimen.findFirst({
        where: {
          id: specimenId,
          organizationId: session.user.organizationId,
          orderId: currentItem.orderId,
          orderItems: { some: { orderItemId, status: "ACTIVE" } },
        },
        select: { id: true, status: true, currentBranchId: true, preanalyticalVersion: true },
      });
      if (!currentSpecimen || currentSpecimen.currentBranchId !== branchId ||
          !["COLLECTED", "RECEIVED", "IN_PROCESS"].includes(currentSpecimen.status)) {
        return { kind: "specimen_state_changed" } as const;
      }
      if (currentSpecimen.status !== "IN_PROCESS") {
        const claimed = await tx.specimen.updateMany({
          where: {
            id: currentSpecimen.id,
            organizationId: session.user.organizationId,
            orderId: currentItem.orderId,
            currentBranchId: branchId,
            status: currentSpecimen.status,
            preanalyticalVersion: currentSpecimen.preanalyticalVersion,
            orderItems: { some: { orderItemId, status: "ACTIVE" } },
          },
          data: { preanalyticalVersion: { increment: 1 } },
        });
        if (claimed.count !== 1) throw new Error("SPECIMEN_PREANALYTICAL_STATE_CHANGED");
      }
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
    return { kind: "created", referral } as const;
  }, { timeout: 30000 }).catch(error => {
    if (error instanceof Error && error.message === "SPECIMEN_PREANALYTICAL_STATE_CHANGED")
      return { kind: "specimen_state_changed" } as const;
    throw error;
  });

  if (outcome.kind === "order_item_changed")
    return NextResponse.json({ error: "order_item_state_changed" }, { status: 409 });
  if (outcome.kind === "active_exists")
    return NextResponse.json({ error: "active_sendout_exists", referralId: outcome.referralId },
      { status: 409, headers: { "Cache-Control": "private, no-store" } });
  if (outcome.kind === "specimen_state_changed")
    return NextResponse.json({ error: "specimen_preanalytical_state_changed" }, { status: 409 });
  return NextResponse.json({ status: "ok", referral: outcome.referral }, { status: 201 });
}
