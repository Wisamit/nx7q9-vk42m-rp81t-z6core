import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { prisma } from "@/lib/db";

const LEASE_MS = 5 * 60_000;

function secretFromReference(reference: string | null) {
  if (!reference) return null;
  if (!reference.startsWith("env:")) throw new Error("UNSUPPORTED_SECRET_REFERENCE");
  const key = reference.slice(4).trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(key)) throw new Error("INVALID_SECRET_REFERENCE");
  const value = process.env[key];
  if (!value) throw new Error("SECRET_NOT_AVAILABLE");
  return value;
}

export function safeOutboundUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("UNSAFE_ENDPOINT_URL");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") ||
      host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid") ||
      host.endsWith(".example") || host.endsWith(".onion") ||
      host === "metadata.google.internal" || host.endsWith(".metadata.google.internal")) {
    throw new Error("UNSAFE_ENDPOINT_HOST");
  }
  // Literal IPs are blocked: prevents loopback, link-local, private, multicast,
  // IPv4-mapped IPv6 and non-canonical address aliases. Endpoint allowlisting
  // and a network-level egress policy are still required for DNS rebinding risk.
  if (isIP(host.replace(/^\\[|\\]$/g, "")) || /^\\[.*\\]$/.test(host) || /^\\d+(\\.\\d+){0,3}$/.test(host)) {
    throw new Error("UNSAFE_IP_ENDPOINT");
  }
  return url;
}

function retryAt(attempt: number) {
  const seconds = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + seconds * 1000);
}

/**
 * At-least-once delivery: claims are CAS-serialized before network calls.
 * A worker that crashes or loses connectivity may cause a retry after the lease,
 * so receivers must de-duplicate by x-family-lab-delivery-id.
 */
export async function dispatchWebhookDelivery(id: string) {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id },
    include: { subscription: { include: { endpoint: true } } },
  });
  if (!delivery) throw new Error("WEBHOOK_DELIVERY_NOT_FOUND");
  const deliveryOrganizationId = delivery.organizationId;
  const endpoint = delivery.subscription.endpoint;
  if (endpoint.organizationId !== delivery.organizationId ||
      delivery.subscription.organizationId !== delivery.organizationId) {
    throw new Error("WEBHOOK_TENANT_MISMATCH");
  }
  if (!endpoint.baseUrl) throw new Error("ENDPOINT_URL_REQUIRED");
  if (endpoint.status !== "ACTIVE" || delivery.subscription.status !== "ACTIVE") {
    throw new Error("ENDPOINT_NOT_ACTIVE");
  }

  const url = safeOutboundUrl(endpoint.baseUrl);
  const body = JSON.stringify(delivery.payload);
  const secret = secretFromReference(endpoint.secretReference);
  const headers = new Headers({
    "content-type": "application/json",
    "user-agent": "FamilyLab-LIS/1.0",
    "x-family-lab-event": delivery.eventType,
    "x-family-lab-delivery-id": delivery.id,
    "x-family-lab-payload-hash": delivery.payloadHash,
  });
  if (endpoint.authType === "API_KEY" && secret) headers.set("x-api-key", secret);
  if (endpoint.authType === "BEARER" && secret) headers.set("authorization", `Bearer ${secret}`);
  if (endpoint.authType === "BASIC" && secret) headers.set("authorization", `Basic ${Buffer.from(secret).toString("base64")}`);
  if (endpoint.authType === "HMAC" && secret) {
    headers.set("x-family-lab-signature", "sha256=" + createHmac("sha256", secret).update(body).digest("hex"));
  }
  if (endpoint.authType !== "NONE" && !secret) throw new Error("ENDPOINT_SECRET_REQUIRED");

  const now = new Date();
  const claimable = (delivery.status === "QUEUED" ||
    (delivery.status === "FAILED" && (!delivery.nextAttemptAt || delivery.nextAttemptAt <= now)) ||
    (delivery.status === "SENT" && delivery.updatedAt <= new Date(now.getTime() - LEASE_MS)));
  if (!claimable) return null;
  if (delivery.attemptCount >= endpoint.maxAttempts) {
    await prisma.webhookDelivery.updateMany({
      where: { id, organizationId: deliveryOrganizationId, status: delivery.status, updatedAt: delivery.updatedAt },
      data: { status: "DEAD_LETTER", nextAttemptAt: null },
    });
    return null;
  }

  const attemptCount = delivery.attemptCount + 1;
  const claim = await prisma.webhookDelivery.updateMany({
    where: {
      id, organizationId: deliveryOrganizationId, status: delivery.status,
      attemptCount: delivery.attemptCount, updatedAt: delivery.updatedAt,
    },
    data: {
      status: "SENT", attemptCount,
      nextAttemptAt: null, lastError: null,
    },
  });
  if (claim.count !== 1) return null;

  // The revision after claiming is used for the completion CAS; an expired
  // worker must not overwrite a newer retry's delivery or acknowledgement.
  const claimed = await prisma.webhookDelivery.findUniqueOrThrow({
    where: { id }, select: { updatedAt: true },
  });
  async function finish(data: {
    status: "DELIVERED" | "FAILED" | "DEAD_LETTER";
    deliveredAt?: Date;
    lastHttpStatus?: number;
    lastError?: string | null;
    nextAttemptAt?: Date | null;
  }) {
    const updated = await prisma.webhookDelivery.updateMany({
      where: {
        id, organizationId: deliveryOrganizationId, status: "SENT",
        attemptCount, updatedAt: claimed.updatedAt,
      },
      data,
    });
    if (updated.count !== 1) return null;
    return prisma.webhookDelivery.findUnique({ where: { id } });
  }

  // A queued clinical-report event can become obsolete before scheduled dispatch.
  // Never transmit an outdated/retracted report version after an amendment.
  if (delivery.reportVersionId &&
      (delivery.eventType === "diagnostic_report.released" ||
       delivery.eventType === "diagnostic_report.amended")) {
    const reportVersion = await prisma.diagnosticReportVersion.findFirst({
      where: { id: delivery.reportVersionId, report: { organizationId: deliveryOrganizationId } },
      select: { status: true, version: true, report: { select: { currentVersion: true } } },
    });
    if (!reportVersion || reportVersion.status === "RETRACTED" ||
        reportVersion.version !== reportVersion.report.currentVersion) {
      return finish({
        status: "DEAD_LETTER", nextAttemptAt: null,
        lastError: "report_version_superseded_or_retracted",
      });
    }
  }

  try {
    const response = await fetch(url, {
      method: "POST", headers, body,
      signal: AbortSignal.timeout(endpoint.timeoutSeconds * 1000),
      redirect: "error",
    });
    if (response.ok) {
      return finish({
        status: "DELIVERED", deliveredAt: new Date(),
        lastHttpStatus: response.status, lastError: null, nextAttemptAt: null,
      });
    }
    const terminal = attemptCount >= endpoint.maxAttempts ||
      (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429);
    return finish({
      status: terminal ? "DEAD_LETTER" : "FAILED", lastHttpStatus: response.status,
      lastError: `HTTP ${response.status}`,
      nextAttemptAt: terminal ? null : retryAt(attemptCount),
    });
  } catch (error) {
    const terminal = attemptCount >= endpoint.maxAttempts;
    return finish({
      status: terminal ? "DEAD_LETTER" : "FAILED",
      lastError: error instanceof Error ? error.message.slice(0, 2000) : "Webhook request failed",
      nextAttemptAt: terminal ? null : retryAt(attemptCount),
    });
  }
}
