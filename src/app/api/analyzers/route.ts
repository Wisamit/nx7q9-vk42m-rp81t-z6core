import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 200) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export async function POST(request: Request) {
  const session = await requirePermission("analyzers.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const branchId = text(body.branchId, 36);
  const departmentId = text(body.departmentId, 36) || null;
  const code = text(body.code, 80).toUpperCase();
  const name = text(body.name, 200);
  const manufacturer = text(body.manufacturer, 150) || null;
  const model = text(body.model, 150) || null;
  const serialNumber = text(body.serialNumber, 150) || null;
  const bridgeDeviceKey = text(body.bridgeDeviceKey, 150) || null;
  const protocol = ["ASTM","HL7_V2","FILE","CSV","HTTP"].includes(body.protocol) ? body.protocol : null;
  const transport = ["SERIAL","TCP_CLIENT","TCP_SERVER","WATCH_FOLDER","HTTP"].includes(body.transport) ? body.transport : null;

  if (!branchId || !code || !name || !protocol || !transport) {
    return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
  }

  const [branchRecord, department, duplicate] = await Promise.all([
    prisma.branch.findFirst({ where: { id: branchId, organizationId: session.user.organizationId, status: "ACTIVE" } }),
    departmentId ? prisma.department.findFirst({
      where: {
        id: departmentId,
        organizationId: session.user.organizationId,
        status: "ACTIVE",
        OR: [{ branchId: null }, { branchId }],
      },
    }) : Promise.resolve(null),
    prisma.analyzer.findFirst({ where: { organizationId: session.user.organizationId, code } }),
  ]);

  if (!branchRecord) return NextResponse.json({ error: "branch_not_found" }, { status: 404 });
  if (departmentId && !department) return NextResponse.json({ error: "department_not_found_for_branch" }, { status: 404 });
  if (duplicate) return NextResponse.json({ error: "analyzer_code_already_exists" }, { status: 409 });

  const analyzer = await prisma.$transaction(async tx => {
    const created = await tx.analyzer.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        departmentId,
        code,
        name,
        manufacturer,
        model,
        serialNumber,
        protocol,
        transport,
        bridgeDeviceKey,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId,
        actorUserId: session.user.id,
        action: "ANALYZER_CREATED",
        entityType: "Analyzer",
        entityId: created.id,
        newValues: { code, name, manufacturer, model, serialNumber, protocol, transport, bridgeDeviceKey, departmentId },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return created;
  });

  return NextResponse.json({ status: "ok", analyzer }, { status: 201 });
}
