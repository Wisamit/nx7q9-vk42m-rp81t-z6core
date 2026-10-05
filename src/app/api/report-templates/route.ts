import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function text(value: unknown, max: number) { return typeof value === "string" ? value.trim().slice(0,max) : ""; }

export async function POST(request: Request) {
  const session = await requirePermission("report_templates.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const code = text(body.code,100).toUpperCase();
  const nameEn = text(body.nameEn,200);
  const nameAr = text(body.nameAr,200) || null;
  const branchId = text(body.branchId,36) || null;
  const isDefault = body.isDefault !== false;
  if (!code || !nameEn) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  if (branchId && !canAccessBranch(session, branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  const template = await prisma.$transaction(async tx => {
    if (isDefault) {
      await tx.reportTemplate.updateMany({
        where: { organizationId: session.user.organizationId, branchId, isDefault: true, status: "ACTIVE" },
        data: { isDefault: false },
      });
    }
    const created = await tx.reportTemplate.create({ data: {
      organizationId: session.user.organizationId, branchId, code, nameEn, nameAr, isDefault, createdByUserId: session.user.id,
    }});
    await tx.auditEvent.create({ data: {
      organizationId: session.user.organizationId, branchId: branchId || session.activeBranchId, actorUserId: session.user.id,
      action: "REPORT_TEMPLATE_CREATED", entityType: "ReportTemplate", entityId: created.id,
      newValues: { code, branchId, isDefault }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    }});
    return created;
  });
  return NextResponse.json({ status:"ok", template }, { status:201 });
}
