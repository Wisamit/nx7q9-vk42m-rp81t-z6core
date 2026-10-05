import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { prisma } from "@/lib/db";

function secretFromReference(reference: string | null) {
  if (!reference) return null;
  if (!reference.startsWith("env:")) throw new Error("UNSUPPORTED_SECRET_REFERENCE");
  const key = reference.slice(4).trim();
  if (!key) throw new Error("INVALID_SECRET_REFERENCE");
  const value = process.env[key];
  if (!value) throw new Error("SECRET_NOT_AVAILABLE");
  return value;
}

function safeOutboundUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("UNSAFE_ENDPOINT_URL");
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local")) throw new Error("UNSAFE_ENDPOINT_HOST");
  if (isIP(host)) {
    if (
      host.startsWith("10.") ||
      host.startsWith("127.") ||
      host.startsWith("169.254.") ||
      host.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host) ||
      host === "::1"
    ) throw new Error("PRIVATE_ENDPOINT_HOST");
  }
  return url;
}

function retryAt(attempt: number) {
  const seconds = Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1));
  return new Date(Date.now() + seconds * 1000);
}

export async function dispatchWebhookDelivery(id: string) {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id },
    include: { subscription: { include: { endpoint: true } } },
  });
  if (!delivery) throw new Error("WEBHOOK_DELIVERY_NOT_FOUND");
  const endpoint = delivery.subscription.endpoint;
  if (!endpoint.baseUrl) throw new Error("ENDPOINT_URL_REQUIRED");
  if (endpoint.status !== "ACTIVE" || delivery.subscription.status !== "ACTIVE") {
    throw new Error("ENDPOINT_NOT_ACTIVE");
  }

  const url = safeOutboundUrl(endpoint.baseUrl);
  const body = JSON.stringify(delivery.payload);
  const headers = new Headers({
    "content-type": "application/json",
    "user-agent": "FamilyLab-LIS/1.0",
    "x-family-lab-event": delivery.eventType,
    "x-family-lab-delivery-id": delivery.id,
  });
  const secret = secretFromReference(endpoint.secretReference);
  if (endpoint.authType === "API_KEY" && secret) headers.set("x-api-key", secret);
  if (endpoint.authType === "BEARER" && secret) headers.set("authorization", `Bearer ${secret}`);
  if (endpoint.authType === "BASIC" && secret) headers.set("authorization", `Basic ${Buffer.from(secret).toString("base64")}`);
  if (endpoint.authType === "HMAC" && secret) {
    headers.set("x-family-lab-signature", "sha256=" + createHmac("sha256", secret).update(body).digest("hex"));
  }

  const attemptCount = delivery.attemptCount + 1;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(endpoint.timeoutSeconds * 1000),
      redirect: "error",
    });
    if (response.ok) {
      return prisma.webhookDelivery.update({
        where: { id },
        data: {
          status: "DELIVERED",
          attemptCount,
          deliveredAt: new Date(),
          lastHttpStatus: response.status,
          lastError: null,
          nextAttemptAt: null,
        },
      });
    }
    const terminal = attemptCount >= endpoint.maxAttempts;
    return prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: terminal ? "DEAD_LETTER" : "FAILED",
        attemptCount,
        lastHttpStatus: response.status,
        lastError: `HTTP ${response.status}`,
        nextAttemptAt: terminal ? null : retryAt(attemptCount),
      },
    });
  } catch (error) {
    const terminal = attemptCount >= endpoint.maxAttempts;
    return prisma.webhookDelivery.update({
      where: { id },
      data: {
        status: terminal ? "DEAD_LETTER" : "FAILED",
        attemptCount,
        lastError: error instanceof Error ? error.message.slice(0, 2000) : "Webhook request failed",
        nextAttemptAt: terminal ? null : retryAt(attemptCount),
      },
    });
  }
}
