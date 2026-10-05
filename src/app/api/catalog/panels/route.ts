import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!permissionSet(session).has("catalog.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = await request.json().catch(() => null);
  const code = typeof body?.code === "string" ? body.code.trim().toUpperCase() : "";
  const nameEn = typeof body?.nameEn === "string" ? body.nameEn.trim() : "";
  const testIds = Array.isArray(body?.testIds) ? [...new Set(body.testIds.filter((x: unknown) => typeof x === "string"))] as string[] : [];
  if (!code || !nameEn || testIds.length === 0 || !/^[A-Z0-9._-]{1,80}$/.test(code)) return NextResponse.json({ error: "invalid_fields" }, { status: 400 });

  const validTests = await prisma.labTest.count({ where: { organizationId: session.user.organizationId, id: { in: testIds } } });
  if (validTests !== testIds.length) return NextResponse.json({ error: "invalid_tests" }, { status: 400 });

  try {
    const panel = await prisma.$transaction(async (tx) => {
      const created = await tx.testPanel.create({ data: { organizationId: session.user.organizationId, code, nameEn, nameAr: typeof body.nameAr === "string" ? body.nameAr.trim() || null : null } });
      await tx.testPanelItem.createMany({ data: testIds.map((testId, index) => ({ panelId: created.id, testId, displayOrder: index, required: true })) });
      await tx.auditEvent.create({ data: { organizationId: session.user.organizationId, branchId: session.activeBranchId, actorUserId: session.userId, action: "CATALOG_PANEL_CREATED", entityType: "TestPanel", entityId: created.id, newValues: { code, nameEn, testIds } } });
      return created;
    });
    return NextResponse.json({ panel }, { status: 201 });
  } catch { return NextResponse.json({ error: "create_failed" }, { status: 409 }); }
}
