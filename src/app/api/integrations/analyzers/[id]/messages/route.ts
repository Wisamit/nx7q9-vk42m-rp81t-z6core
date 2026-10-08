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

  const bridgeMessageId = text(request.headers.get("x-bridge-message-id"), 150);
  if (!bridgeMessageId) return NextResponse.json({ error: "bridge_message_id_required" }, { status: 400 });

  const body = await request.json().catch(() => null) as { rawPayload?: unknown; protocol?: string } | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const rawPayload = text(body.rawPayload, 1000000);
  if (!rawPayload) return NextResponse.json({ error: "raw_payload_required" }, { status: 400 });

  const protocol = body.protocol || credential.analyzer.protocol;
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
    if (existing.payloadHash !== payloadHash) {
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

  const stored = await prisma.$transaction(async tx => {
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
          payloadBytes: Buffer.byteLength(rawPayload, "utf8"),
          credentialId: credential.id,
        },
        reason: "Authenticated Analyzer Bridge ingestion",
      },
    });

    return { message: created, duplicate: false };
  }).catch(async error => {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    // A concurrent Bridge retry won the unique (analyzer, bridgeMessageId)
    // race. Return an idempotent response only for byte-identical payloads.
    const existing = await prisma.analyzerMessage.findUnique({
      where: {
        analyzerId_bridgeMessageId: {
          analyzerId: credential.analyzer.id,
          bridgeMessageId,
        },
      },
    });
    return existing ? { message: existing, duplicate: true } : null;
  });
  if (!stored) return NextResponse.json({ error: "bridge_message_conflict_retry" }, { status: 409 });
  const message = stored.message;
  if (message.payloadHash !== payloadHash) {
    return NextResponse.json({ error: "bridge_message_id_payload_conflict", messageId: message.id }, { status: 409 });
  }
  const duplicate = stored.duplicate;
  return NextResponse.json({
    status: "ok",
    duplicate,
    messageId: message.id,
    messageStatus: message.status,
  }, { status: duplicate ? 200 : 202 });
}
