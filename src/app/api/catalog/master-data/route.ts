import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";

const resources = {
  departments: prisma.department,
  specimens: prisma.specimenType,
  containers: prisma.container,
  methods: prisma.method,
  units: prisma.unit,
} as const;

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const type = typeof body?.type === "string" ? body.type : "";
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const nameEn = typeof body?.nameEn === "string" ? body.nameEn.trim() : "";
  const nameAr = typeof body?.nameAr === "string" ? body.nameAr.trim() : "";
  if (!(type in resources) || !code || !nameEn || !/^[A-Z0-9._-]{1,50}$/.test(code)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  try {
    let record: { id: string; code: string };
    if (type === "departments") {
      record = await prisma.department.create({ data: { organizationId: session.user.organizationId, code, nameEn, nameAr: nameAr || null } });
    } else if (type === "specimens") {
      record = await prisma.specimenType.create({ data: { organizationId: session.user.organizationId, code, nameEn, nameAr: nameAr || null } });
    } else if (type === "containers") {
      record = await prisma.container.create({ data: { organizationId: session.user.organizationId, code, nameEn, nameAr: nameAr || null, tubeColor: typeof body.tubeColor === "string" ? body.tubeColor.trim() || null : null, additive: typeof body.additive === "string" ? body.additive.trim() || null : null } });
    } else if (type === "methods") {
      record = await prisma.method.create({ data: { organizationId: session.user.organizationId, code, nameEn, nameAr: nameAr || null } });
    } else {
      const symbol = typeof body.symbol === "string" ? body.symbol.trim() : "";
      if (!symbol) return NextResponse.json({ error: "symbol_required" }, { status: 400 });
      record = await prisma.unit.create({ data: { organizationId: session.user.organizationId, code, symbol, nameEn: nameEn || null, nameAr: nameAr || null, ucumCode: typeof body.ucumCode === "string" ? body.ucumCode.trim() || null : null } });
    }

    await prisma.auditEvent.create({
      data: { organizationId: session.user.organizationId, branchId: session.activeBranchId, actorUserId: session.userId, action: "CATALOG_MASTER_CREATED", entityType: type, entityId: record.id, newValues: { code: record.code, nameEn } },
    });
    return NextResponse.json({ record }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "create_failed" }, { status: 409 });
  }
}
