import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 150) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("analyzers.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const name = text(body.name, 150);
  const expiresAt = body.expiresAt ? new Date(String(body.expiresAt)) : null;
  if (!name) return NextResponse.json({ error: "credential_name_required" }, { status: 400 });
  if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) {
    return NextResponse.json({ error: "invalid_credential_expiry" }, { status: 400 });
  }

  const analyzer = await prisma.analyzer.findFirst({
    where: { id, organizationId: session.user.organizationId },
  });
  if (!analyzer) return NextResponse.json({ error: "analyzer_not_found" }, { status: 404 });
  if (!canAccessBranch(session, analyzer.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const token = "flab_" + randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const tokenPrefix = token.slice(0, 14);

  const credential = await prisma.$transaction(async tx => {
    const created = await tx.analyzerCredential.create({
      data: { analyzerId: analyzer.id, name, tokenPrefix, tokenHash, expiresAt },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: analyzer.branchId,
        actorUserId: session.user.id,
        action: "ANALYZER_BRIDGE_CREDENTIAL_CREATED",
        entityType: "AnalyzerCredential",
        entityId: created.id,
        newValues: { analyzerId: analyzer.id, name, tokenPrefix, expiresAt },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({
    status: "ok",
    credential: {
      id: credential.id,
      name: credential.name,
      tokenPrefix: credential.tokenPrefix,
      expiresAt: credential.expiresAt,
    },
    token,
    warning: "This token is shown once. Store it securely in the Analyzer Bridge.",
  }, { status: 201 });
}
