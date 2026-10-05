import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { IntegrationAuthError, requireIntegrationApiKey } from "@/lib/integration-auth";
import { prisma } from "@/lib/db";

const ALLOWED_EVENT_TYPES = new Set([
  "QUEUE_TICKET_EVENT",
  "APPOINTMENT_CHECKIN",
  "EQUIPMENT_HEARTBEAT",
  "EDGE_HEALTH_EVENT",
]);

function text(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  try {
    const auth = await requireIntegrationApiKey(request, "edge.sync");
    const body = await request.json().catch(() => null) as {
      edgeNodeCode?: unknown;
      softwareVersion?: unknown;
      messages?: unknown;
    } | null;
    if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

    const edgeNodeCode = text(body.edgeNodeCode, 80).toUpperCase();
    const softwareVersion = text(body.softwareVersion, 80) || null;
    const inputMessages = Array.isArray(body.messages) ? body.messages : [];
    if (!edgeNodeCode || inputMessages.length > 100) {
      return NextResponse.json({ error: "invalid_edge_batch" }, { status: 400 });
    }

    const node = await prisma.edgeNode.findFirst({
      where: { organizationId: auth.organizationId, code: edgeNodeCode, status: "ACTIVE" },
      include: { branch: { include: { continuityPolicy: true } } },
    });
    if (!node) return NextResponse.json({ error: "edge_node_not_found" }, { status: 404 });
    if (auth.endpoint.branchId && auth.endpoint.branchId !== node.branchId) {
      return NextResponse.json({ error: "edge_branch_scope_mismatch" }, { status: 403 });
    }
    if (node.branch.continuityPolicy?.mode !== "BUFFER_NON_CLINICAL" || node.branch.continuityPolicy.offlineClinicalWritesAllowed) {
      return NextResponse.json({ error: "edge_buffering_disabled" }, { status: 409 });
    }

    const normalized: Array<{ idempotencyKey: string; eventType: string; payload: unknown; payloadHash: string }> = [];
    let approximateBytes = 0;
    for (const raw of inputMessages) {
      if (!raw || typeof raw !== "object") return NextResponse.json({ error: "invalid_edge_message" }, { status: 400 });
      const item = raw as Record<string, unknown>;
      const idempotencyKey = text(item.idempotencyKey, 160);
      const eventType = text(item.eventType, 120).toUpperCase();
      if (!idempotencyKey || !ALLOWED_EVENT_TYPES.has(eventType)) {
        return NextResponse.json({ error: "edge_event_type_not_allowed", eventType }, { status: 409 });
      }
      const payload = item.payload ?? {};
      const serialized = JSON.stringify(payload);
      approximateBytes += Buffer.byteLength(serialized, "utf8");
      if (approximateBytes > 512_000) return NextResponse.json({ error: "edge_batch_too_large" }, { status: 413 });
      normalized.push({
        idempotencyKey,
        eventType,
        payload,
        payloadHash: createHash("sha256").update(serialized).digest("hex"),
      });
    }

    const now = new Date();
    const accepted: Array<{ idempotencyKey: string; id: string; duplicate: boolean }> = [];
    await prisma.$transaction(async tx => {
      for (const item of normalized) {
        const existing = await tx.edgeQueueMessage.findUnique({
          where: {
            edgeNodeId_direction_idempotencyKey: {
              edgeNodeId: node.id,
              direction: "TO_CENTRAL",
              idempotencyKey: item.idempotencyKey,
            },
          },
          select: { id: true, payloadHash: true },
        });
        if (existing) {
          if (existing.payloadHash !== item.payloadHash) throw new Error("IDEMPOTENCY_PAYLOAD_MISMATCH");
          accepted.push({ idempotencyKey: item.idempotencyKey, id: existing.id, duplicate: true });
          continue;
        }
        const created = await tx.edgeQueueMessage.create({
          data: {
            organizationId: auth.organizationId,
            branchId: node.branchId,
            edgeNodeId: node.id,
            direction: "TO_CENTRAL",
            eventType: item.eventType,
            idempotencyKey: item.idempotencyKey,
            payload: item.payload as never,
            payloadHash: item.payloadHash,
            status: "RECEIVED",
            attemptCount: 1,
            receivedAt: now,
          },
        });
        accepted.push({ idempotencyKey: item.idempotencyKey, id: created.id, duplicate: false });
      }
      await tx.edgeNode.update({
        where: { id: node.id },
        data: { lastHeartbeatAt: now, lastSyncAt: now, softwareVersion: softwareVersion || node.softwareVersion },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: auth.organizationId,
          branchId: node.branchId,
          actorUserId: null,
          action: "EDGE_BUFFER_BATCH_RECEIVED",
          entityType: "EdgeNode",
          entityId: node.id,
          newValues: { receivedCount: normalized.length, duplicateCount: accepted.filter(item => item.duplicate).length },
          reason: "Non-clinical edge events staged idempotently; no clinical record mutation performed.",
        },
      });
    }, { isolationLevel: "Serializable" });

    return NextResponse.json({ status: "ok", accepted });
  } catch (error) {
    if (error instanceof IntegrationAuthError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    if (error instanceof Error && error.message === "IDEMPOTENCY_PAYLOAD_MISMATCH") {
      return NextResponse.json({ error: "idempotency_payload_mismatch" }, { status: 409 });
    }
    return NextResponse.json({ error: "edge_sync_failed" }, { status: 500 });
  }
}
