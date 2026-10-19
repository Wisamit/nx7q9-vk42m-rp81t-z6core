import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../generated/prisma/client";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null) as { action?: unknown; [key: string]: unknown } | null;
  const action = text(body?.action, 40).toUpperCase();
  const permission = action === "VERIFY" || action === "COMPLETE" ? "sendouts.verify" : "sendouts.manage";
  const session = await requirePermission(permission);
  const ctx = await requestContext();

  const referral = await prisma.sendOutReferral.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      externalLaboratory: true,
      orderItem: { include: { order: { select: { accessionNumber: true } } } },
      specimen: true,
    },
  });
  if (!referral) return NextResponse.json({ error: "sendout_not_found" }, { status: 404 });
  if (!canAccessBranch(session, referral.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  let nextStatus: "DISPATCHED" | "RESULT_RECEIVED" | "VERIFIED" | "COMPLETED" | "CANCELLED";
  let update: Prisma.SendOutReferralUncheckedUpdateManyInput = {};
  let eventMetadata: Record<string, unknown> = {};

  if (action === "DISPATCH") {
    if (referral.status !== "CREATED") return NextResponse.json({ error: "invalid_status_transition" }, { status: 409 });
    nextStatus = "DISPATCHED";
    update = {
      status: nextStatus,
      externalAccession: text(body?.externalAccession, 120) || referral.externalAccession,
      courier: text(body?.courier, 150) || null,
      trackingReference: text(body?.trackingReference, 150) || null,
      dispatchedByUserId: session.user.id,
      dispatchedAt: new Date(),
    };
    eventMetadata = { courier: update.courier, trackingReference: update.trackingReference, externalAccession: update.externalAccession };
  } else if (action === "RECEIVE_RESULT") {
    if (referral.status !== "DISPATCHED") return NextResponse.json({ error: "invalid_status_transition" }, { status: 409 });
    const externalResultText = text(body?.externalResultText, 20000);
    const attachmentCount = await prisma.attachment.count({
      where: {
        organizationId: session.user.organizationId,
        targetType: "SEND_OUT_REFERRAL",
        targetId: referral.id,
      },
    });
    if (!externalResultText && attachmentCount === 0) {
      return NextResponse.json({ error: "external_result_or_attachment_required" }, { status: 409 });
    }
    nextStatus = "RESULT_RECEIVED";
    update = {
      status: nextStatus,
      externalResultText: externalResultText || null,
      receivedByUserId: session.user.id,
      resultReceivedAt: new Date(),
    };
    eventMetadata = { attachmentCount, hasResultText: Boolean(externalResultText) };
  } else if (action === "VERIFY") {
    if (referral.status !== "RESULT_RECEIVED") return NextResponse.json({ error: "invalid_status_transition" }, { status: 409 });
    nextStatus = "VERIFIED";
    update = { status: nextStatus, verifiedByUserId: session.user.id, verifiedAt: new Date() };
  } else if (action === "COMPLETE") {
    if (referral.status !== "VERIFIED") return NextResponse.json({ error: "invalid_status_transition" }, { status: 409 });
    nextStatus = "COMPLETED";
    update = { status: nextStatus };
  } else if (action === "CANCEL") {
    if (!["CREATED", "DISPATCHED"].includes(referral.status)) return NextResponse.json({ error: "invalid_status_transition" }, { status: 409 });
    nextStatus = "CANCELLED";
    update = { status: nextStatus };
  } else {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const note = text(body?.note, 1000) || null;
  // The UI already requires a documented cancellation; the API must enforce
  // the same audit invariant for direct clients and automated integrations.
  if (action === "CANCEL" && !note) {
    return NextResponse.json({ error: "cancellation_reason_required" }, { status: 400 });
  }
  const outcome = await prisma.$transaction(async tx => {
    // A stale UI action must not overwrite a newer transition or append a false
    // custody/verification event. InnoDB serializes this conditional update.
    const claimed = await tx.sendOutReferral.updateMany({
      where: {
        id: referral.id,
        organizationId: session.user.organizationId,
        branchId: referral.branchId,
        status: referral.status,
      },
      data: update,
    });
    if (claimed.count !== 1) return { kind: "changed" } as const;
    const saved = await tx.sendOutReferral.findUniqueOrThrow({ where: { id: referral.id } });
    if (action === "DISPATCH") {
      const currentItem = await tx.orderItem.findFirst({
        where: { id: referral.orderItemId, order: { organizationId: session.user.organizationId } },
        select: { status: true, order: { select: { status: true } } },
      });
      if (!currentItem || ["CANCELLED", "VERIFIED"].includes(currentItem.status) ||
          ["CANCELLED", "COMPLETED"].includes(currentItem.order.status)) {
        throw new Error("SENDOUT_ORDER_NO_LONGER_ACTIVE");
      }
    }
    if (action === "DISPATCH" && referral.specimenId) {
      // Claim current specimen custody before emitting a dispatch event.
      // Quarantined, transferred, rejected or unlinked samples cannot be
      // represented as physically dispatched from the referral branch.
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM specimens WHERE id = ${referral.specimenId} FOR UPDATE
      `;
      const specimen = rows.length === 1 ? await tx.specimen.findFirst({
        where: {
          id: referral.specimenId,
          organizationId: session.user.organizationId,
          orderId: referral.orderItem.orderId,
          orderItems: { some: { orderItemId: referral.orderItemId, status: "ACTIVE" } },
        },
        select: { currentBranchId: true, status: true },
      }) : null;
      if (!specimen || specimen.currentBranchId !== referral.branchId ||
          !["COLLECTED", "RECEIVED", "IN_PROCESS"].includes(specimen.status)) {
        throw new Error("SENDOUT_SPECIMEN_CUSTODY_CHANGED");
      }
    }
    await tx.sendOutEvent.create({
      data: {
        referralId: referral.id,
        fromStatus: referral.status,
        toStatus: nextStatus,
        actorUserId: session.user.id,
        note,
        metadata: Object.keys(eventMetadata).length ? eventMetadata as Prisma.InputJsonValue : undefined,
      },
    });

    if (action === "DISPATCH" && referral.specimen) {
      await tx.specimenEvent.create({
        data: {
          specimenId: referral.specimen.id,
          eventType: "TRANSFERRED",
          branchId: referral.branchId,
          actorUserId: session.user.id,
          fromStatus: referral.specimen.status,
          toStatus: referral.specimen.status,
          details: {
            sendOutReferralId: referral.id,
            externalLaboratoryCode: referral.externalLaboratory.code,
            externalLaboratoryName: referral.externalLaboratory.nameEn,
            externalAccession: update.externalAccession || null,
          },
        },
      });
      if (referral.orderItem.status === "ORDERED" || referral.orderItem.status === "COLLECTED") {
        await tx.orderItem.update({ where: { id: referral.orderItemId }, data: { status: "IN_PROGRESS" } });
      }
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: referral.branchId,
        actorUserId: session.user.id,
        action: "SEND_OUT_" + action,
        entityType: "SendOutReferral",
        entityId: referral.id,
        oldValues: { status: referral.status },
        newValues: { status: nextStatus, ...eventMetadata } as Prisma.InputJsonValue,
        reason: note,
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return { kind: "updated", referral: saved } as const;
  }).catch(error => {
    // Throw inside the transaction to roll back the status claim itself.
    if (error instanceof Error && error.message === "SENDOUT_SPECIMEN_CUSTODY_CHANGED") {
      return { kind: "specimen_changed" } as const;
    }
    if (error instanceof Error && error.message === "SENDOUT_ORDER_NO_LONGER_ACTIVE") {
      return { kind: "order_changed" } as const;
    }
    throw error;
  });

  if (outcome.kind === "order_changed") {
    return NextResponse.json({ error: "sendout_order_no_longer_active" }, { status: 409 });
  }
  if (outcome.kind === "specimen_changed") {
    return NextResponse.json({ error: "sendout_specimen_custody_changed" }, { status: 409 });
  }
  if (outcome.kind === "changed") {
    return NextResponse.json({ error: "sendout_state_changed" }, { status: 409 });
  }
  return NextResponse.json({ status: "ok", referral: outcome.referral });
}
