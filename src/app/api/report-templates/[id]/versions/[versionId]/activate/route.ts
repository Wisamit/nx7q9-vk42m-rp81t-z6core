import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  immediateReportTemplateActivationOnly, reportTemplateActivationError,
  reportTemplateEditorIsLive,
} from "@/lib/report-template-governance";

export async function POST(request: Request, { params }: {
  params: Promise<{ id: string; versionId: string }>;
}) {
  const session = await requirePermission("report_templates.manage");
  const ctx = await requestContext();
  const { id, versionId } = await params;
  const body = await request.json().catch(() => null);
  if (!immediateReportTemplateActivationOnly(body)) {
    return NextResponse.json({ error: "template_activation_must_be_immediate" }, { status: 400 });
  }

  const organizationId = session.user.organizationId;
  const outcome = await prisma.$transaction(async tx => {
    // A single template row lock fences competing approvals and activations.
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
    const invalid = reportTemplateActivationError(version, session.user.id);
    if (invalid) return { error: invalid, status: 409 } as const;
    const active = await tx.reportTemplateVersion.findMany({
      where: { templateId: id, status: "EFFECTIVE" },
      select: { id: true, effectiveFrom: true, effectiveTo: true },
    });
    if (active.length > 1 || active.some(item => !item.effectiveFrom || item.effectiveTo)) {
      return { error: "template_effective_history_inconsistent", status: 409 } as const;
    }
    const now = new Date();
    if (active.some(item => item.effectiveFrom!.getTime() >= now.getTime())) {
      return { error: "template_effective_window_overlap", status: 409 } as const;
    }
    if (active.length === 1) {
      const retired = await tx.reportTemplateVersion.updateMany({
        where: { id: active[0].id, templateId: id, status: "EFFECTIVE",
          effectiveFrom: { lt: now }, effectiveTo: null },
        data: { status: "RETIRED", effectiveTo: now, retiredAt: now },
      });
      if (retired.count !== 1) return { error: "template_version_claim_conflict", status: 409 } as const;
    }
    const claimed = await tx.reportTemplateVersion.updateMany({
      where: { id: version.id, templateId: id, status: "APPROVED", effectiveFrom: null,
        approvedByUserId: version.approvedByUserId, approvedAt: version.approvedAt },
      data: { status: "EFFECTIVE", effectiveFrom: now, effectiveTo: null },
    });
    if (claimed.count !== 1) return { error: "template_version_claim_conflict", status: 409 } as const;
    await tx.auditEvent.create({ data: {
      organizationId, branchId: template.branchId ?? session.activeBranchId,
      actorUserId: session.user.id, action: "REPORT_TEMPLATE_VERSION_ACTIVATED",
      entityType: "ReportTemplateVersion", entityId: version.id,
      oldValues: { status: "APPROVED" },
      newValues: { status: "EFFECTIVE", effectiveFrom: now,
        retiredPreviousVersionId: active[0]?.id ?? null,
        approvedByUserId: version.approvedByUserId },
      reason: "Independently approved report layout activated immediately",
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    } });
    return { versionId: version.id, effectiveFrom: now } as const;
  }, { isolationLevel: "Serializable", timeout: 20000 });
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
  return NextResponse.json({ status: "EFFECTIVE", ...outcome }, { headers: { "Cache-Control": "private, no-store" } });
}
