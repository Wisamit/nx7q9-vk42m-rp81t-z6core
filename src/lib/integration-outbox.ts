import { createHash } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";
import { buildHl7OruR01 } from "@/lib/hl7-v2";

type Snapshot = Parameters<typeof buildHl7OruR01>[0];

export async function queueReportIntegrations(tx: Prisma.TransactionClient, input: {
  organizationId: string;
  branchId: string;
  orderId: string;
  reportVersionId: string;
  reportVersion: number;
  reportStatus: "PARTIAL" | "FINAL" | "AMENDED" | "RETRACTED";
  issuedAt: Date;
  snapshot: Snapshot;
}) {
  const eventType = input.reportStatus === "AMENDED"
    ? "diagnostic_report.amended"
    : "diagnostic_report.released";

  const subscriptions = await tx.webhookSubscription.findMany({
    where: {
      organizationId: input.organizationId,
      eventType,
      status: "ACTIVE",
      endpoint: {
        status: "ACTIVE",
        endpointType: { in: ["WEBHOOK","REST"] },
        direction: { in: ["OUTBOUND","BIDIRECTIONAL"] },
        baseUrl: { not: null },
        OR: [{ branchId: null }, { branchId: input.branchId }],
      },
    },
    include: { endpoint: true },
  });

  const webhookPayload = {
    eventType,
    occurredAt: input.issuedAt.toISOString(),
    organizationId: input.organizationId,
    branchId: input.branchId,
    orderId: input.orderId,
    accessionNumber: input.snapshot.order.accessionNumber,
    reportVersionId: input.reportVersionId,
    reportVersion: input.reportVersion,
    reportStatus: input.reportStatus,
  };
  const webhookPayloadHash = createHash("sha256").update(JSON.stringify(webhookPayload)).digest("hex");

  for (const subscription of subscriptions) {
    await tx.webhookDelivery.create({
      data: {
        organizationId: input.organizationId,
        subscriptionId: subscription.id,
        reportVersionId: input.reportVersionId,
        eventType,
        payload: webhookPayload,
        payloadHash: webhookPayloadHash,
      },
    });
  }

  const hl7Endpoints = await tx.integrationEndpoint.findMany({
    where: {
      organizationId: input.organizationId,
      status: "ACTIVE",
      endpointType: "HL7_V2",
      direction: { in: ["OUTBOUND","BIDIRECTIONAL"] },
      OR: [{ branchId: null }, { branchId: input.branchId }],
    },
  });

  for (const endpoint of hl7Endpoints) {
    const controlId = `RPT-${input.reportVersionId}`;
    const payload = buildHl7OruR01(input.snapshot, controlId, input.issuedAt);
    const payloadHash = createHash("sha256").update(payload).digest("hex");
    await tx.integrationMessage.create({
      data: {
        organizationId: input.organizationId,
        branchId: input.branchId,
        endpointId: endpoint.id,
        direction: "OUTBOUND",
        messageType: "ORU^R01",
        controlId,
        orderId: input.orderId,
        reportVersionId: input.reportVersionId,
        payloadText: payload,
        payloadHash,
        status: "QUEUED",
      },
    });
  }

  return { webhookCount: subscriptions.length, hl7Count: hl7Endpoints.length };
}
