import { NextResponse } from "next/server";
import { IntegrationAuthError, requireIntegrationApiKey } from "@/lib/integration-auth";
import { prisma } from "@/lib/db";

function retryAt(attempt: number) {
  const seconds = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + seconds * 1000);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireIntegrationApiKey(request, "messages.ack");
    const { id } = await params;
    const body = await request.json().catch(() => null) as { code?: unknown; payload?: unknown; error?: unknown } | null;
    const code = ["AA","AE","AR"].includes(String(body?.code || "")) ? String(body?.code) : null;
    const acknowledgementPayload = typeof body?.payload === "string" ? body.payload.slice(0, 65535) : null;
    const lastError = typeof body?.error === "string" ? body.error.slice(0, 2000) : null;
    if (!code) return NextResponse.json({ error: "invalid_acknowledgement_code" }, { status: 400 });

    const message = await prisma.integrationMessage.findFirst({
      where: {
        id,
        organizationId: auth.organizationId,
        endpointId: auth.endpoint.id,
        direction: "OUTBOUND",
      },
    });
    if (!message) return NextResponse.json({ error: "message_not_found" }, { status: 404 });

    if (code === "AA") {
      const updated = await prisma.integrationMessage.update({
        where: { id: message.id },
        data: {
          status: "ACKNOWLEDGED",
          acknowledgementCode: code,
          acknowledgementPayload,
          processedAt: new Date(),
          nextAttemptAt: null,
          lastError: null,
        },
      });
      return NextResponse.json({ status: "ok", messageStatus: updated.status });
    }

    const terminal = message.attemptCount >= auth.endpoint.maxAttempts;
    const updated = await prisma.integrationMessage.update({
      where: { id: message.id },
      data: {
        status: terminal ? "DEAD_LETTER" : "FAILED",
        acknowledgementCode: code,
        acknowledgementPayload,
        lastError: lastError || `HL7 acknowledgement ${code}`,
        nextAttemptAt: terminal ? null : retryAt(message.attemptCount),
      },
    });
    return NextResponse.json({ status: "ok", messageStatus: updated.status, nextAttemptAt: updated.nextAttemptAt });
  } catch (error) {
    if (error instanceof IntegrationAuthError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: "message_ack_failed" }, { status: 500 });
  }
}
