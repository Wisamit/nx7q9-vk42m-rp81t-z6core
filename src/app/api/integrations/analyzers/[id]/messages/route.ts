import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../../generated/prisma/client";
import { prisma } from "@/lib/db";
import { authenticateAnalyzerBridge } from "@/lib/analyzer-auth";

function text(value: unknown, max = 1000000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const credential = await authenticateAnalyzerBridge(request, id);
  if (!credential) return NextResponse.json({ error: "analyzer_bridge_unauthorized" }, { status: 401 });

  const messageHeader = request.headers.get("x-bridge-message-id");
  const bridgeMessageId = typeof messageHeader === "string" ? messageHeader.trim() : "";
  if (!bridgeMessageId || bridgeMessageId.length > 150) {
    return NextResponse.json({ error: "invalid_bridge_message_id" }, { status: 400 });
  }

  const body = await request.json().catch(() => null) as { rawPayload?: unknown; protocol?: unknown } | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  // Do not trim or truncate raw analyzer payload: CR/LF, spaces and control
  // characters are part of the ASTM/HL7 frame and its forensic hash.
  const rawPayload = body.rawPayload;
  if (typeof rawPayload !== "string" || rawPayload.length === 0) {
    return NextResponse.json({ error: "raw_payload_required" }, { status: 400 });
  }
  const payloadBytes = Buffer.byteLength(rawPayload, "utf8");
  if (payloadBytes > 1000000) {
    return NextResponse.json({ error: "raw_payload_too_large" }, { status: 413 });
  }
  const protocol = body.protocol ?? credential.analyzer.protocol;
  if (protocol !== credential.analyzer.protocol) {
    return NextResponse.json({
      error: "analyzer_protocol_mismatch",
      configuredProtocol: credential.analyzer.protocol,
    }, { status: 409 });
  }

  const payloadHash = createHash("sha256").update(rawPayload).digest("hex");
  const existing = await prisma.analyzerMessage.findUnique({
    where: {
      analyzerId_bridgeMessageId: {
        analyzerId: credential.analyzer.id,
        bridgeMessageId,
      },
    },
  });

  if (existing) {
    if (existing.payloadHash !== payloadHash || existing.protocol !== protocol) {
      return NextResponse.json({
        error: "bridge_message_id_payload_conflict",
        messageId: existing.id,
      }, { status: 409 });
    }

    return NextResponse.json({
      status: "ok",
      duplicate: true,
      messageId: existing.id,
      messageStatus: existing.status,
    });
  }

  const message = await prisma.$transaction(async tx => {
    const created = await tx.analyzerMessage.create({
      data: {
        analyzerId: credential.analyzer.id,
        branchId: credential.analyzer.branchId,
        direction: "INBOUND",
        protocol: credential.analyzer.protocol,
        bridgeMessageId,
        payloadHash,
        rawPayload,
        status: "RECEIVED",
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: credential.analyzer.organizationId,
        branchId: credential.analyzer.branchId,
        actorUserId: null,
        action: "ANALYZER_MESSAGE_RECEIVED",
        entityType: "AnalyzerMessage",
        entityId: created.id,
        newValues: {
          analyzerId: credential.analyzer.id,
          analyzerCode: credential.analyzer.code,
          bridgeMessageId,
          protocol: credential.analyzer.protocol,
          payloadHash,
          payloadBytes,
          credentialId: credential.id,
        },
        reason: "Authenticated Analyzer Bridge ingestion",
      },
    });

    return created;
  }).catch(async error => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    // The unique index is authoritative under concurrent bridge retries.
    return null;
  });
  if (!message) {
    const winner = await prisma.analyzerMessage.findUnique({
      where: { analyzerId_bridgeMessageId: { analyzerId: credential.analyzer.id, bridgeMessageId } },
    });
    if (!winner) return NextResponse.json({ error: "concurrent_message_retry" }, { status: 409 });
    if (winner.payloadHash !== payloadHash || winner.protocol !== protocol) {
      return NextResponse.json({ error: "bridge_message_id_payload_conflict", messageId: winner.id }, { status: 409 });
    }
    return NextResponse.json({ status: "ok", duplicate: true, messageId: winner.id, messageStatus: winner.status });
  }

  return NextResponse.json({
    status: "ok",
    duplicate: false,
    messageId: message.id,
    messageStatus: message.status,
  }, { status: 202 });
}
