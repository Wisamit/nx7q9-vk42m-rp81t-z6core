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

  const testIds = [...new Set(input.snapshot.results.map(result => result.testId))];
  const componentIds = [...new Set(input.snapshot.results.flatMap(result =>
    result.values.map(value => value.componentId).filter((id): id is string => Boolean(id))
  ))];
  const loincMappings = await tx.terminologyMapping.findMany({
    where: {
      organizationId: input.organizationId,
      system: "LOINC",
      status: "ACTIVE",
      isPrimary: true,
      effectiveFrom: { lte: input.issuedAt },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: input.issuedAt } }],
      AND: [{
        OR: [
          { testId: { in: testIds }, componentId: null },
          ...(componentIds.length ? [{ componentId: { in: componentIds } }] : []),
        ],
      }],
    },
    orderBy: { effectiveFrom: "desc" },
  });
  const testLoinc = new Map<string,string>();
  const componentLoinc = new Map<string,string>();
  for (const mapping of loincMappings) {
    if (mapping.componentId) {
      if (!componentLoinc.has(mapping.componentId)) componentLoinc.set(mapping.componentId, mapping.code);
    } else if (!testLoinc.has(mapping.testId)) {
      testLoinc.set(mapping.testId, mapping.code);
    }
  }
  const hl7Snapshot: Snapshot = {
    ...input.snapshot,
    results: input.snapshot.results.map(result => ({
      ...result,
      loincCode: testLoinc.get(result.testId) || null,
      values: result.values.map(value => ({
        ...value,
        loincCode: value.componentId ? componentLoinc.get(value.componentId) || null : testLoinc.get(result.testId) || null,
      })),
    })),
  };

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
    const payload = buildHl7OruR01(hl7Snapshot, controlId, input.issuedAt);
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
