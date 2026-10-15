import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import {
  parseProviderReceipt, verifyProviderReceiptSignature, providerReceiptFingerprint, ProviderReceiptError,
} from "@/lib/provider-receipt-security";
import { NotificationDeliveryStatus } from "../../../../../generated/prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (value: Record<string, unknown>, code = 200) =>
  NextResponse.json(value, { status: code, headers: { "Cache-Control": "no-store" } });

/** Gateway receipt (not a patient/staff endpoint). Only a signed, bound provider event is accepted. */
export async function POST(request: Request) {
  try {
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
      return json({ error: "invalid_receipt_content_type" }, 415);
    }
    const declared = request.headers.get("content-length");
    if (declared && (!/^\d{1,5}$/.test(declared) || Number(declared) > 8192)) {
      return json({ error: "receipt_too_large" }, 413);
    }
    const raw = await request.text();
    const receipt = parseProviderReceipt(raw);
    verifyProviderReceiptSignature(raw, receipt, request.headers.get("x-family-lab-timestamp"),
      request.headers.get("x-family-lab-signature"), process.env.NOTIFICATION_RECEIPT_MASTER_SECRET);
    const fingerprint = providerReceiptFingerprint(receipt);
    const result = await prisma.$transaction(async tx => {
      const delivery = await tx.notificationDelivery.findFirst({
        where: {
          id: receipt.deliveryId,
          notification: { organizationId: receipt.organizationId },
          channel: receipt.channel,
          providerMessageId: receipt.providerMessageId,
        },
        include: {
          notification: { select: { branchId: true } },
          reportDeliveryEvent: { select: { reportVersionId: true } },
        },
      });
      if (!delivery) return { code: 404, outcome: "receipt_delivery_not_found" };
      if (delivery.receiptFingerprint) {
        return delivery.receiptFingerprint === fingerprint
          ? { code: 200, outcome: "replayed" } : { code: 409, outcome: "receipt_conflict" };
      }
      // An inline synchronous DELIVERED response may precede the signed callback.
      if (delivery.status !== NotificationDeliveryStatus.SENT &&
          !(delivery.status === NotificationDeliveryStatus.DELIVERED && receipt.status === "DELIVERED")) {
        return { code: 409, outcome: "receipt_not_pending" };
      }
      if (receipt.status === "DELIVERED" && delivery.reportDeliveryEvent) {
        const version = await tx.diagnosticReportVersion.findFirst({
          where: { id: delivery.reportDeliveryEvent.reportVersionId, report: { organizationId: receipt.organizationId } },
          select: { status: true, version: true, report: { select: { currentVersion: true } } },
        });
        if (!version || version.status === "RETRACTED" || version.version !== version.report.currentVersion) {
          return { code: 409, outcome: "report_version_superseded_or_retracted" };
        }
      }
      const now = new Date();
      const nextStatus = receipt.status === "DELIVERED"
        ? NotificationDeliveryStatus.DELIVERED : NotificationDeliveryStatus.DEAD_LETTER;
      const changed = await tx.notificationDelivery.updateMany({
        where: {
          id: receipt.deliveryId,
          notification: { organizationId: receipt.organizationId },
          channel: receipt.channel,
          providerMessageId: receipt.providerMessageId,
          receiptFingerprint: null,
          status: delivery.status,
        },
        data: {
          status: nextStatus,
          receiptFingerprint: fingerprint,
          deliveredAt: receipt.status === "DELIVERED" ? now : null,
          nextAttemptAt: null,
          lastError: receipt.status === "FAILED" ? "provider_reported_delivery_failure" : null,
        },
      });
      if (changed.count !== 1) return { code: 409, outcome: "receipt_claim_race" };
      if (delivery.reportDeliveryEventId) {
        await tx.reportDeliveryEvent.update({
          where: { id: delivery.reportDeliveryEventId },
          data: {
            status: receipt.status === "DELIVERED" ? "DELIVERED" : "FAILED",
            externalRef: receipt.providerMessageId,
          },
        });
      }
      await tx.auditEvent.create({
        data: {
          organizationId: receipt.organizationId,
          branchId: delivery.notification.branchId,
          actorUserId: null,
          action: "NOTIFICATION_PROVIDER_RECEIPT",
          entityType: "NotificationDelivery",
          entityId: delivery.id,
          newValues: {
            channel: receipt.channel, status: receipt.status, receiptFingerprint: fingerprint,
            providerMessageId: receipt.providerMessageId,
          },
          reason: "Authenticated gateway disposition; no patient data in audit",
        },
      });
      return { code: 200, outcome: "applied" };
    }, { isolationLevel: "Serializable" });
    return json({ status: result.code === 200 ? "ok" : "rejected", outcome: result.outcome }, result.code);
  } catch (error) {
    if (error instanceof ProviderReceiptError) return json({ error: error.code }, error.httpStatus);
    return json({ error: "provider_receipt_failed" }, 500);
  }
}
