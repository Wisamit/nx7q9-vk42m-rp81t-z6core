import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { CompositeWriteError, parseCompositeMembers, withScopedCompositeCreation } from "@/lib/catalog-composite-write";

export async function POST(request: Request) {
  const session = await requirePermission("catalog.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || Array.isArray(body) || typeof body !== "object")
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
  const nameEn = typeof body.nameEn === "string" ? body.nameEn.trim() : "";
  const nameAr = typeof body.nameAr === "string" ? body.nameAr.trim() || null : null;
  if (!/^[A-Z0-9._-]{1,80}$/.test(code) || !nameEn || nameEn.length > 200 ||
      (nameAr !== null && nameAr.length > 200))
    return NextResponse.json({ error: "invalid_fields" }, { status: 400 });
  try {
    const members = parseCompositeMembers(body, "PANEL");
    const panel = await withScopedCompositeCreation(session, members.map(m => m.testId), async tx => {
      const duplicate = await tx.testPanel.findUnique({
        where: { organizationId_code: { organizationId: session.user.organizationId, code } },
        select: { id: true },
      });
      if (duplicate) throw new CompositeWriteError("panel_code_exists", 409);
      const created = await tx.testPanel.create({ data: {
        organizationId: session.user.organizationId, code, nameEn, nameAr,
      } });
      await tx.testPanelItem.createMany({ data: members.map(member => ({
        panelId: created.id, testId: member.testId,
        displayOrder: member.displayOrder, required: member.required,
      })) });
      await tx.auditEvent.create({ data: {
        organizationId: session.user.organizationId, branchId: session.activeBranchId,
        actorUserId: session.user.id, action: "CATALOG_PANEL_CREATED",
        entityType: "TestPanel", entityId: created.id,
        newValues: { code, nameEn, members,
          authorizedBranchId: session.activeBranchId, scopedMembership: true },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return created;
    });
    return NextResponse.json({ panel }, { status: 201 });
  } catch (error) {
    if (error instanceof CompositeWriteError)
      return NextResponse.json({ error: error.code }, { status: error.status });
    if (error && typeof error === "object" && "code" in error &&
        error.code === "P2002")
      return NextResponse.json({ error: "panel_code_exists" }, { status: 409 });
    throw error;
  }
}
