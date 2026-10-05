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
    const duplicate = await prisma.integrationMessage.findFirst({
      where: {
        endpointId: auth.endpoint.id,
        direction: "INBOUND",
        controlId: msh.controlId,
        payloadHash,
      },
      select: { id: true, status: true },
    });

    if (!duplicate) {
      const now = new Date();
      const message = await prisma.integrationMessage.create({
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
          receivedAt: now,
        },
      });
      await prisma.auditEvent.create({
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
    }

    return new NextResponse(buildHl7Ack({
      originalSendingApplication: msh.sendingApplication,
      originalSendingFacility: msh.sendingFacility,
      controlId: msh.controlId,
      acknowledgementCode: "AA",
      message: duplicate ? "Duplicate message already received" : "Accepted",
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
