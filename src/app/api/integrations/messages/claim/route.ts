import { NextResponse } from "next/server";
import { IntegrationAuthError, requireIntegrationApiKey } from "@/lib/integration-auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request) {
  try {
    const auth = await requireIntegrationApiKey(request, "messages.read");
    if (auth.endpoint.endpointType !== "HL7_V2" || !["OUTBOUND","BIDIRECTIONAL"].includes(auth.endpoint.direction)) {
      return NextResponse.json({ error: "endpoint_not_outbound_hl7" }, { status: 403 });
    }

    const now = new Date();
    const staleSent = new Date(now.getTime() - 5 * 60_000);
    const candidates = await prisma.integrationMessage.findMany({
      where: {
        organizationId: auth.organizationId,
        endpointId: auth.endpoint.id,
        direction: "OUTBOUND",
        OR: [
          { status: "QUEUED" },
          { status: "FAILED", OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { status: "SENT", updatedAt: { lte: staleSent } },
        ],
      },
      orderBy: { createdAt: "asc" },
      take: 20,
    });

    const claimed = [];
    for (const candidate of candidates) {
      const updated = await prisma.integrationMessage.updateMany({
        where: {
          id: candidate.id,
          status: candidate.status,
          updatedAt: candidate.updatedAt,
        },
        data: {
          status: "SENT",
          attemptCount: { increment: 1 },
          nextAttemptAt: null,
          lastError: null,
        },
      });
      if (updated.count === 1) {
        claimed.push({
          id: candidate.id,
          messageType: candidate.messageType,
          controlId: candidate.controlId,
          payload: candidate.payloadText,
          payloadHash: candidate.payloadHash,
          attempt: candidate.attemptCount + 1,
        });
      }
    }

    return NextResponse.json({ status: "ok", messages: claimed });
  } catch (error) {
    if (error instanceof IntegrationAuthError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "message_claim_failed" }, { status: 500 });
  }
}
