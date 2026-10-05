import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const testId = typeof body?.testId === "string" ? body.testId : "";
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const nameEn = typeof body?.nameEn === "string" ? body.nameEn.trim() : "";
  if (!testId || !code || !nameEn || !/^[A-Z0-9._-]{1,80}$/.test(code)) return NextResponse.json({ error: "invalid_fields" }, { status: 400 });

  const test = await prisma.labTest.findFirst({ where: { id: testId, organizationId: session.user.organizationId } });
  if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });

  try {
    const component = await prisma.$transaction(async (tx) => {
      const created = await tx.testComponent.create({
        data: {
          testId, code, nameEn,
          nameAr: typeof body.nameAr === "string" ? body.nameAr.trim() || null : null,
          unitId: body.unitId || null,
          resultType: ["TEXT","QUALITATIVE","BOOLEAN","DATE"].includes(body.resultType) ? body.resultType : "NUMERIC",
          decimalPrecision: Number.isInteger(body.decimalPrecision) ? body.decimalPrecision : null,
          displayOrder: Number.isInteger(body.displayOrder) ? body.displayOrder : 0,
        },
      });
      await tx.auditEvent.create({ data: { organizationId: session.user.organizationId, branchId: session.activeBranchId, actorUserId: session.userId, action: "CATALOG_COMPONENT_CREATED", entityType: "TestComponent", entityId: created.id, newValues: { testId, code, nameEn } } });
      return created;
    });
    return NextResponse.json({ component }, { status: 201 });
  } catch { return NextResponse.json({ error: "create_failed" }, { status: 409 }); }
}
