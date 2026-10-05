import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.view")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const tests = await prisma.labTest.findMany({
    where: { organizationId: session.user.organizationId },
    include: { department: true, specimenType: true, defaultUnit: true, components: { orderBy: { displayOrder: "asc" } } },
    orderBy: [{ status: "asc" }, { nameEn: "asc" }],
  });
  return NextResponse.json({ tests });
}

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const nameEn = typeof body?.nameEn === "string" ? body.nameEn.trim() : "";
  const nameAr = typeof body?.nameAr === "string" ? body.nameAr.trim() : "";
  if (!code || !nameEn || !/^[A-Z0-9._-]{1,80}$/.test(code)) {
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  }

  try {
    const test = await prisma.$transaction(async (tx) => {
      const created = await tx.labTest.create({
        data: {
          organizationId: session.user.organizationId,
          code,
          nameEn,
          nameAr: nameAr || null,
          abbreviation: typeof body.abbreviation === "string" ? body.abbreviation.trim().slice(0, 80) || null : null,
          resultType: body.resultType === "TEXT" || body.resultType === "QUALITATIVE" || body.resultType === "BOOLEAN" || body.resultType === "DATE" ? body.resultType : "NUMERIC",
          departmentId: body.departmentId || null,
          specimenTypeId: body.specimenTypeId || null,
          containerId: body.containerId || null,
          methodId: body.methodId || null,
          defaultUnitId: body.defaultUnitId || null,
          decimalPrecision: Number.isInteger(body.decimalPrecision) ? body.decimalPrecision : null,
          tatMinutes: Number.isInteger(body.tatMinutes) ? body.tatMinutes : null,
          loincCode: typeof body.loincCode === "string" ? body.loincCode.trim().slice(0, 30) || null : null,
        },
      });

      if (session.activeBranchId) {
        await tx.testBranchAvailability.create({ data: { testId: created.id, branchId: session.activeBranchId, performedHere: true } });
      }

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.userId,
          action: "CATALOG_TEST_CREATED",
          entityType: "LabTest",
          entityId: created.id,
          newValues: { code: created.code, nameEn: created.nameEn, nameAr: created.nameAr },
        },
      });
      return created;
    });
    return NextResponse.json({ test }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "create_failed" }, { status: 409 });
  }
}
