import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

const ALLOWED_SCOPES = new Set(["fhir.read","hl7.write","messages.read","messages.ack"]);

function text(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("integrations.api_keys.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const endpointId = text(body.endpointId, 36);
  const name = text(body.name, 160);
  const scopeValues: string[] = [];
  if (Array.isArray(body.scopes)) {
    for (const scope of body.scopes) {
      if (typeof scope === "string" && ALLOWED_SCOPES.has(scope)) scopeValues.push(scope);
    }
  }
  const scopes = [...new Set(scopeValues)];
  const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : null;

  if (!endpointId || !name || scopes.length === 0) {
    return NextResponse.json({ error: "endpoint_name_and_scope_required" }, { status: 400 });
  }
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) {
    return NextResponse.json({ error: "invalid_expiry" }, { status: 400 });
  }

  const endpoint = await prisma.integrationEndpoint.findFirst({
    where: { id: endpointId, organizationId: session.user.organizationId, status: "ACTIVE" },
  });
  if (!endpoint) return NextResponse.json({ error: "endpoint_not_found" }, { status: 404 });
  if (endpoint.branchId && !canAccessBranch(session, endpoint.branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const prefix = randomBytes(6).toString("hex");
  const secret = randomBytes(32).toString("base64url");
  const plainTextKey = `flis_${prefix}_${secret}`;
  const keyHash = createHash("sha256").update(plainTextKey).digest("hex");

  const apiKey = await prisma.$transaction(async tx => {
    const created = await tx.integrationApiKey.create({
      data: {
        organizationId: session.user.organizationId,
        endpointId,
        name,
        keyPrefix: prefix,
        keyHash,
        scopes,
        expiresAt,
        createdByUserId: session.user.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: endpoint.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: "INTEGRATION_API_KEY_CREATED",
        entityType: "IntegrationApiKey",
        entityId: created.id,
        newValues: { endpointId, name, keyPrefix: prefix, scopes, expiresAt },
        reason: "Secret returned once and stored only as SHA-256 hash",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({
    status: "ok",
    apiKey: {
      id: apiKey.id,
      name: apiKey.name,
      keyPrefix: apiKey.keyPrefix,
      scopes,
      expiresAt: apiKey.expiresAt,
      secret: plainTextKey,
      warning: "Copy this key now. It cannot be retrieved again.",
    },
  }, { status: 201 });
}
