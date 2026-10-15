import { NextResponse } from "next/server";
import { IntegrationAuthError, requireIntegrationApiKey } from "@/lib/integration-auth";
import { prisma } from "@/lib/db";
import { parseOutboundAck, outboundAckFingerprint, OutboundAckError } from "@/lib/hl7-outbound-ack";

function retryAt(attempt: number) {
  const seconds = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + seconds * 1000);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireIntegrationApiKey(request, "messages.ack");
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (auth.endpoint.endpointType !== "HL7_V2" ||
        !["OUTBOUND", "BIDIRECTIONAL"].includes(auth.endpoint.direction)) {
      return NextResponse.json({ error: "endpoint_not_outbound_hl7" }, { status: 403 });
    }

    const message = await prisma.integrationMessage.findFirst({
      where: {
        id,
        organizationId: auth.organizationId,
        endpointId: auth.endpoint.id,
        direction: "OUTBOUND",
      },
    });
    if (!message) return NextResponse.json({ error: "message_not_found" }, { status: 404 });
    const acknowledgement = parseOutboundAck(body, message.controlId);
    const { code, attempt: expectedAttempt, payload: acknowledgementPayload, error: lastError } = acknowledgement;
    const fingerprint = outboundAckFingerprint(acknowledgement);
    if (message.status !== "SENT" || message.attemptCount !== expectedAttempt) {
      if (message.attemptCount === expectedAttempt && message.ackFingerprint === fingerprint &&
          ["ACKNOWLEDGED","FAILED","DEAD_LETTER"].includes(message.status)) {
        return NextResponse.json({ status: "ok", messageStatus: message.status, replayed: true });
      }
      return NextResponse.json({ error: "stale_or_unclaimed_acknowledgement" }, { status: 409 });
    }

    const terminal = code !== "AA" && expectedAttempt >= auth.endpoint.maxAttempts;
    const nextStatus = code === "AA" ? "ACKNOWLEDGED" : terminal ? "DEAD_LETTER" : "FAILED";
    const nextAttemptAt = code === "AA" || terminal ? null : retryAt(expectedAttempt);
    const updated = await prisma.$transaction(async tx => {
      const claim = await tx.integrationMessage.updateMany({
        where: {
          id, organizationId: auth.organizationId,
          endpointId: auth.endpoint.id,
          direction: "OUTBOUND", status: "SENT",
          attemptCount: expectedAttempt, updatedAt: message.updatedAt,
        },
        data: {
          status: nextStatus,
          acknowledgementCode: code,
          acknowledgementPayload,
          ackFingerprint: fingerprint,
          processedAt: code === "AA" ? new Date() : null,
          nextAttemptAt,
          lastError: code === "AA" ? null : lastError || `HL7 acknowledgement ${code}`,
        },
      });
      if (claim.count !== 1) return false;
      await tx.auditEvent.create({
        data: {
          organizationId: auth.organizationId,
          branchId: message.branchId,
          actorUserId: null,
          action: "HL7_OUTBOUND_ACKNOWLEDGEMENT",
          entityType: "IntegrationMessage",
          entityId: id,
          newValues: { endpointId: auth.endpoint.id, code, attempt: expectedAttempt, nextStatus, ackFingerprint: fingerprint, wireAckPresent: Boolean(acknowledgementPayload) },
          reason: "Acknowledgement matched current outbound delivery attempt",
        },
      });
      return true;
    }, { isolationLevel: "Serializable" });
    if (!updated) return NextResponse.json({ error: "stale_or_unclaimed_acknowledgement" }, { status: 409 });
    return NextResponse.json({ status: "ok", messageStatus: nextStatus, nextAttemptAt, replayed: false });
  } catch (error) {
    if (error instanceof OutboundAckError) return NextResponse.json({ error: error.code }, { status: 400 });
    if (error instanceof IntegrationAuthError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "message_ack_failed" }, { status: 500 });
  }
}
