import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { IntegrationAuthError, requireIntegrationApiKey } from "@/lib/integration-auth";
import { buildHl7Ack, parseHl7Msh } from "@/lib/hl7-v2";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const auth = await requireIntegrationApiKey(request, "hl7.write");
    if (auth.endpoint.endpointType !== "HL7_V2" || !["INBOUND","BIDIRECTIONAL"].includes(auth.endpoint.direction)) {
      return new NextResponse(buildHl7Ack({
        originalSendingApplication: "",
        originalSendingFacility: "",
        controlId: "",
        acknowledgementCode: "AR",
        message: "Endpoint does not accept inbound HL7 v2",
      }), { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    const payload = await request.text();
    if (!payload || payload.length > 2_000_000) {
      return new NextResponse("HL7 payload missing or too large", { status: 413 });
    }

    const msh = parseHl7Msh(payload);
    if (!msh?.messageType || !msh.controlId) {
      return new NextResponse(buildHl7Ack({
        originalSendingApplication: msh?.sendingApplication || "",
        originalSendingFacility: msh?.sendingFacility || "",
        controlId: msh?.controlId || "",
        acknowledgementCode: "AR",
        message: "Invalid MSH segment",
      }), { status: 400, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    const payloadHash = createHash("sha256").update(payload).digest("hex");
    // The sending system must never reuse an MSH-10 control ID with different
    // clinical content. Lock the endpoint before the duplicate decision so
    // parallel deliveries cannot independently create the same control ID.
    const acceptance = await prisma.$transaction(async tx => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM integration_endpoints WHERE id = ${auth.endpoint.id}
        AND organization_id = ${auth.organizationId} AND status = 'ACTIVE' FOR UPDATE
      `;
      if (locked.length !== 1) return "ENDPOINT_INACTIVE" as const;

      const previous = await tx.integrationMessage.findFirst({
        where: {
          organizationId: auth.organizationId,
          endpointId: auth.endpoint.id,
          direction: "INBOUND",
          controlId: msh.controlId,
        },
        select: { id: true, payloadHash: true },
      });
      if (previous) return previous.payloadHash === payloadHash ? "DUPLICATE" as const : "CONFLICT" as const;

      const message = await tx.integrationMessage.create({
        data: {
          organizationId: auth.organizationId,
          branchId: auth.endpoint.branchId,
          endpointId: auth.endpoint.id,
          direction: "INBOUND",
          messageType: msh.messageType,
          controlId: msh.controlId,
          payloadText: payload,
          payloadHash,
          status: "RECEIVED",
          receivedAt: new Date(),
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: auth.organizationId,
          branchId: auth.endpoint.branchId,
          actorUserId: null,
          action: "HL7_MESSAGE_RECEIVED",
          entityType: "IntegrationMessage",
          entityId: message.id,
          newValues: {
            endpointId: auth.endpoint.id,
            messageType: msh.messageType,
            controlId: msh.controlId,
            payloadHash,
          },
          reason: "Inbound HL7 message accepted into integration queue; no clinical mutation performed",
        },
      });
      return "ACCEPTED" as const;
    }, { isolationLevel: "Serializable", timeout: 30000 });

    if (acceptance === "CONFLICT" || acceptance === "ENDPOINT_INACTIVE") {
      return new NextResponse(buildHl7Ack({
        originalSendingApplication: msh.sendingApplication,
        originalSendingFacility: msh.sendingFacility,
        controlId: msh.controlId,
        acknowledgementCode: "AR",
        message: acceptance === "CONFLICT" ? "Control ID already used with different payload" : "Endpoint disabled",
      }), { status: 409, headers: { "content-type": "text/plain; charset=utf-8" } });
    }

    return new NextResponse(buildHl7Ack({
      originalSendingApplication: msh.sendingApplication,
      originalSendingFacility: msh.sendingFacility,
      controlId: msh.controlId,
      acknowledgementCode: "AA",
      message: acceptance === "DUPLICATE" ? "Duplicate message already received" : "Accepted",
    }), { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
  } catch (error) {
    if (error instanceof IntegrationAuthError) {
      return new NextResponse(`MSH|^~\\&|FAMILY_LAB|LIS|||||ACK||P|2.5.1\rMSA|AR||${error.code}\r`, {
        status: error.status,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
    return new NextResponse("HL7 intake failed", { status: 500 });
  }
}
