import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function GET() {
  const session = await requirePermission("resilience.view");
  const branchIds = session.user.branchScopes.map(scope => scope.branchId);
  const nodes = await prisma.edgeNode.findMany({
    where: { organizationId: session.user.organizationId, branchId: { in: branchIds } },
    include: {
      branch: { select: { code: true, nameEn: true } },
      _count: { select: { messages: true } },
    },
    orderBy: [{ branch: { nameEn: "asc" } }, { code: "asc" }],
  });
  return NextResponse.json({ nodes });
}

export async function POST(request: Request) {
  const session = await requirePermission("resilience.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36);
  const code = text(body.code, 80).toUpperCase();
  const name = text(body.name, 200);
  const softwareVersion = text(body.softwareVersion, 80) || null;
  if (!branchId || !code || !name) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  if (!canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  if (!/^[A-Z0-9._-]{2,80}$/.test(code)) return NextResponse.json({ error: "invalid_code" }, { status: 400 });

  let node;
  try {
    node = await prisma.$transaction(async tx => {
      // Serializes registration with branch continuity disable.
      const locked=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM branches WHERE id=${branchId}
        AND organization_id=${session.user.organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("BRANCH_NOT_ACTIVE");
      const policy = await tx.branchContinuityPolicy.findUnique({ where: { branchId } });
      if (!policy || policy.mode !== "BUFFER_NON_CLINICAL" || policy.offlineClinicalWritesAllowed) {
        throw new Error("EDGE_BUFFERING_DISABLED");
      }
    const created = await tx.edgeNode.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        code,
        name,
        softwareVersion,
        createdByUserId: session.user.id,
      },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        actorUserId: session.user.id,
        action: "EDGE_NODE_CREATED",
        entityType: "EdgeNode",
        entityId: created.id,
        newValues: { code, name, softwareVersion, mode: policy.mode },
        reason: "Edge node may buffer non-clinical events only; offline clinical writes remain disabled.",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
    },{isolationLevel:"Serializable",timeout:30000});
  } catch (error) {
    const code=error instanceof Error?error.message:"";
    return NextResponse.json({error:code==="EDGE_BUFFERING_DISABLED"?"branch_non_clinical_buffering_not_enabled":"edge_node_registration_conflict"},{status:409});
  }

  return NextResponse.json({ status: "ok", node }, { status: 201 });
}
