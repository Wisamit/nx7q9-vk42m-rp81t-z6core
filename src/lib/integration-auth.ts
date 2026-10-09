import { createHash, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

export class IntegrationAuthError extends Error {
  status: number;
  code: string;
  constructor(code: string, status = 401) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function scopeList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export async function requireIntegrationApiKey(request: Request, requiredScope: string) {
  const headerKey = request.headers.get("x-api-key")?.trim();
  const authorization = request.headers.get("authorization")?.trim();
  const rawKey = headerKey || (authorization?.startsWith("Bearer ") ? authorization.slice(7).trim() : "");

  if (!rawKey || !rawKey.startsWith("flis_")) throw new IntegrationAuthError("integration_api_key_required");
  const parts = rawKey.split("_");
  const prefix = parts.length >= 3 ? parts[1] : "";
  if (!prefix) throw new IntegrationAuthError("integration_api_key_invalid");

  const apiKey = await prisma.integrationApiKey.findUnique({
    where: { keyPrefix: prefix },
    include: { endpoint: true },
  });

  if (!apiKey || apiKey.revokedAt || apiKey.endpoint.status !== "ACTIVE" ||
      apiKey.organizationId !== apiKey.endpoint.organizationId) {
    throw new IntegrationAuthError("integration_api_key_invalid");
  }
  if (apiKey.expiresAt && apiKey.expiresAt <= new Date()) {
    throw new IntegrationAuthError("integration_api_key_expired");
  }

  const actualHash = Buffer.from(sha256(rawKey), "hex");
  const expectedHash = Buffer.from(apiKey.keyHash, "hex");
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    throw new IntegrationAuthError("integration_api_key_invalid");
  }

  const scopes = scopeList(apiKey.scopes);
  if (!scopes.includes(requiredScope) && !scopes.includes("*")) {
    throw new IntegrationAuthError("integration_scope_forbidden", 403);
  }

  await prisma.integrationApiKey.update({
    where: { id: apiKey.id },
    data: { lastUsedAt: new Date() },
  });

  return {
    apiKeyId: apiKey.id,
    organizationId: apiKey.organizationId,
    endpoint: apiKey.endpoint,
    scopes,
  };
}
