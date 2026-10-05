import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 1000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function validUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const session = await requirePermission("integrations.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const code = text(body.code, 80).toUpperCase();
  const name = text(body.name, 220);
  const branchId = text(body.branchId, 36) || null;
  const endpointType = ["FHIR_R4","HL7_V2","REST","WEBHOOK"].includes(body.endpointType) ? body.endpointType : null;
  const direction = ["INBOUND","OUTBOUND","BIDIRECTIONAL"].includes(body.direction) ? body.direction : null;
  const authType = ["NONE","API_KEY","BEARER","BASIC","HMAC"].includes(body.authType) ? body.authType : "NONE";
  const baseUrl = text(body.baseUrl, 1000) || null;
  const secretReference = text(body.secretReference, 500) || null;
  const timeoutSeconds = Number(body.timeoutSeconds || 15);
  const maxAttempts = Number(body.maxAttempts || 5);

  if (!code || !name || !endpointType || !direction) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (baseUrl && !validUrl(baseUrl)) {
    return NextResponse.json({ error: "https_endpoint_required" }, { status: 400 });
  }
  if (authType !== "NONE" && (!secretReference || !secretReference.startsWith("env:"))) {
    return NextResponse.json({ error: "env_secret_reference_required" }, { status: 400 });
  }
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 60) {
    return NextResponse.json({ error: "invalid_timeout" }, { status: 400 });
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 20) {
    return NextResponse.json({ error: "invalid_max_attempts" }, { status: 400 });
  }
  if (branchId) {
    const branch = await prisma.branch.findFirst({
      where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" },
    });
    if (!branch) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
    if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  try {
    const endpoint = await prisma.$transaction(async tx => {
      const created = await tx.integrationEndpoint.create({
        data: {
          organizationId: session.user.organizationId,
          branchId,
          code,
          name,
          endpointType,
          direction,
          baseUrl,
          authType,
          secretReference,
          timeoutSeconds,
          maxAttempts,
          createdByUserId: session.user.id,
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: branchId || session.activeBranchId,
          actorUserId: session.user.id,
          action: "INTEGRATION_ENDPOINT_CREATED",
          entityType: "IntegrationEndpoint",
          entityId: created.id,
          newValues: { code, name, branchId, endpointType, direction, baseUrl, authType, secretReference, timeoutSeconds, maxAttempts },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", endpoint }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unique constraint")) {
      return NextResponse.json({ error: "endpoint_code_exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "endpoint_create_failed" }, { status: 500 });
  }
}
