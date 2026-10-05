import { NextResponse } from "next/server";
import { canAccessBranch, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("quality.documents.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const body = await request.json().catch(() => null) as { action?: string; effectiveFrom?: string } | null;
  const action = body?.action;
  if (!["SUBMIT_REVIEW","COMPLETE_REVIEW","APPROVE","MAKE_EFFECTIVE"].includes(action || "")) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }

  const version = await prisma.qualityDocumentVersion.findFirst({
    where: { id, document: { organizationId: session.user.organizationId } },
    include: { document: true },
  });
  if (!version) return NextResponse.json({ error: "document_version_not_found" }, { status: 404 });
  if (version.document.branchId && !canAccessBranch(session, version.document.branchId)) return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });

  if (action === "SUBMIT_REVIEW" && version.status !== "DRAFT") return NextResponse.json({ error: "draft_version_required" }, { status: 409 });
  if (action === "COMPLETE_REVIEW" && version.status !== "IN_REVIEW") return NextResponse.json({ error: "version_in_review_required" }, { status: 409 });
  if (action === "APPROVE" && version.status !== "REVIEWED") return NextResponse.json({ error: "reviewed_version_required" }, { status: 409 });
  if (action === "MAKE_EFFECTIVE" && version.status !== "APPROVED") return NextResponse.json({ error: "approved_version_required" }, { status: 409 });

  const now = new Date();
  const effectiveFrom = body?.effectiveFrom ? new Date(body.effectiveFrom) : now;
  if (action === "MAKE_EFFECTIVE" && Number.isNaN(effectiveFrom.getTime())) return NextResponse.json({ error: "invalid_effective_date" }, { status: 400 });
  if (action === "MAKE_EFFECTIVE" && effectiveFrom > now) return NextResponse.json({ error: "future_effective_activation_not_supported" }, { status: 409 });

  const saved = await prisma.$transaction(async tx => {
    let updated;
    if (action === "SUBMIT_REVIEW") {
      updated = await tx.qualityDocumentVersion.update({
        where: { id },
        data: { status: "IN_REVIEW" },
      });
    } else if (action === "COMPLETE_REVIEW") {
      updated = await tx.qualityDocumentVersion.update({
        where: { id },
        data: { status: "REVIEWED", reviewedByUserId: session.user.id, reviewedAt: now },
      });
    } else if (action === "APPROVE") {
      updated = await tx.qualityDocumentVersion.update({
        where: { id },
        data: { status: "APPROVED", approvedByUserId: session.user.id, approvedAt: now },
      });
    } else {
      const currentlyEffective = await tx.qualityDocumentVersion.findMany({
        where: { documentId: version.documentId, status: "EFFECTIVE", id: { not: id } },
        select: { id: true },
      });
      if (currentlyEffective.length) {
        await tx.qualityDocumentVersion.updateMany({
          where: { id: { in: currentlyEffective.map(item => item.id) } },
          data: { status: "RETIRED", retiredAt: now },
        });
      }
      updated = await tx.qualityDocumentVersion.update({
        where: { id },
        data: { status: "EFFECTIVE", effectiveFrom, retiredAt: null },
      });
      await tx.qualityDocument.update({
        where: { id: version.documentId },
        data: { currentEffectiveVersion: version.version },
      });
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: version.document.branchId || session.activeBranchId,
        actorUserId: session.user.id,
        action: `QUALITY_DOCUMENT_${action}`,
        entityType: "QualityDocumentVersion",
        entityId: version.id,
        oldValues: { status: version.status },
        newValues: { status: updated.status, version: version.version, effectiveFrom: updated.effectiveFrom },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
    return updated;
  });

  return NextResponse.json({ status: "ok", version: saved });
}
