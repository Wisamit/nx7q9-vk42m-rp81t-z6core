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

  let saved;
  try {
    saved = await prisma.$transaction(async tx => {
      // Serialize sibling version activation through their common document.
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM quality_documents WHERE id = ${version.documentId}
        AND organization_id = ${session.user.organizationId} AND status = 'ACTIVE'
        FOR UPDATE
      `;
      if (locked.length !== 1) throw new Error("DOCUMENT_NOT_ACTIVE");
      const currentDocument = await tx.qualityDocument.findUniqueOrThrow({ where: { id: version.documentId } });
      const current = await tx.qualityDocumentVersion.findUniqueOrThrow({ where: { id } });
      const expectedStatus = action === "SUBMIT_REVIEW" ? "DRAFT"
        : action === "COMPLETE_REVIEW" ? "IN_REVIEW"
        : action === "APPROVE" ? "REVIEWED" : "APPROVED";
      if (current.status !== expectedStatus) throw new Error("DOCUMENT_VERSION_STATE_CHANGED");
      if (action === "MAKE_EFFECTIVE" && current.version <= currentDocument.currentEffectiveVersion) {
        throw new Error("OLDER_VERSION_CANNOT_REPLACE_EFFECTIVE");
      }
      const claim = await tx.qualityDocumentVersion.updateMany({
        where: { id, documentId: version.documentId, status: expectedStatus },
        data: action === "SUBMIT_REVIEW"
          ? { status: "IN_REVIEW" }
          : action === "COMPLETE_REVIEW"
            ? { status: "REVIEWED", reviewedByUserId: session.user.id, reviewedAt: now }
            : action === "APPROVE"
              ? { status: "APPROVED", approvedByUserId: session.user.id, approvedAt: now }
              : { status: "EFFECTIVE", effectiveFrom, retiredAt: null },
      });
      if (claim.count !== 1) throw new Error("DOCUMENT_VERSION_STATE_CHANGED");
      let updated = await tx.qualityDocumentVersion.findUniqueOrThrow({ where: { id } });
      if (action === "MAKE_EFFECTIVE") {
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
    }, { isolationLevel: "Serializable", timeout: 30000 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    return NextResponse.json({ error: reason === "OLDER_VERSION_CANNOT_REPLACE_EFFECTIVE"
      ? "older_version_cannot_replace_effective" : "document_workflow_state_conflict" }, { status: 409 });
  }

  return NextResponse.json({ status: "ok", version: saved });
}
