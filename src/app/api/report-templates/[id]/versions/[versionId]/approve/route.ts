import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  reportTemplateApprovalError, reportTemplateEditorIsLive,
} from "@/lib/report-template-governance";

export async function POST(request: Request, { params }: {
  params: Promise<{ id: string; versionId: string }>;
}) {
  const session = await requirePermission("report_templates.manage");
  const ctx = await requestContext();
  const { id, versionId } = await params;
  const body = await request.json().catch(() => null) as Record<string, unknown> | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (body?.confirmation !== "APPROVE_EXACT_REPORT_LAYOUT_VERSION" ||
      reason.length < 12 || reason.length > 1000) {
    return NextResponse.json({ error: "template_explicit_approval_reason_required" }, { status: 400 });
  }
  const organizationId = session.user.organizationId;
  const outcome = await prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM report_templates
      WHERE id = ${id} AND organization_id = ${organizationId}
        AND status = 'ACTIVE' FOR UPDATE
    `;
    if (locked.length !== 1) return { error: "template_not_found", status: 404 } as const;
    const template = await tx.reportTemplate.findUnique({
      where: { id }, select: { id: true, branchId: true },
    });
    if (!template) return { error: "template_not_found", status: 404 } as const;
    if (template.branchId && !canAccessBranch(session, template.branchId))
      return { error: "branch_forbidden", status: 403 } as const;
    if (!(await reportTemplateEditorIsLive(tx, {
      organizationId, userId: session.user.id, branchId: template.branchId,
      activeBranchId: session.activeBranchId,
      sessionBranchIds: session.user.branchScopes.filter(b =>
        b.branch.status === "ACTIVE" && b.branch.organizationId === organizationId
      ).map(b => b.branchId),
    }))) return { error: "template_authorization_changed", status: 403 } as const;
    const version = await tx.reportTemplateVersion.findFirst({
      where: { id: versionId, templateId: id },
    });
    if (!version) return { error: "template_version_not_found", status: 404 } as const;
    const transitionError = reportTemplateApprovalError(version, session.user.id);
    if (transitionError) return { error: transitionError, status: 409 } as const;
    const now = new Date();
    const claimed = await tx.reportTemplateVersion.updateMany({
      where: { id: version.id, templateId: id, status: "DRAFT",
        submittedByUserId: { not: session.user.id }, approvedByUserId: null },
      data: { status: "APPROVED", approvedByUserId: session.user.id, approvedAt: now },
    });
    if (claimed.count !== 1) return { error: "template_version_claim_conflict", status: 409 } as const;
    await tx.auditEvent.create({ data: {
      organizationId, branchId: template.branchId ?? session.activeBranchId,
      actorUserId: session.user.id, action: "REPORT_TEMPLATE_VERSION_INDEPENDENTLY_APPROVED",
      entityType: "ReportTemplateVersion", entityId: version.id,
      oldValues: { status: "DRAFT" },
      newValues: { status: "APPROVED", version: version.version, approvedAt: now },
      reason, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    } });
    return { versionId: version.id, approvedAt: now } as const;
  }, { isolationLevel: "Serializable", timeout: 20000 });
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ status: "APPROVED", ...outcome }, { headers: { "Cache-Control": "private, no-store" } });
}
