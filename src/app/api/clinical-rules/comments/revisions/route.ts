import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { commentTemplateReviewFingerprint } from "@/lib/comment-template-approval";
import {
  parseCommentRevisionRequest, revisionCode, validateCommentRevisionSource,
} from "@/lib/comment-template-revisions";
import { ClinicalCommentDraftError } from "@/lib/comment-template-draft";

class RevisionConflict extends Error {
  constructor(readonly reason: string, readonly statusCode = 409) {
    super(reason);
  }
}

export async function POST(request: Request) {
  const session = await requirePermission("result_comments.manage");
  const organizationId = session.user.organizationId;
  const branchId = session.activeBranchId;
  if (!branchId || !session.user.branchScopes.some(scope =>
    scope.branchId === branchId && scope.branch.status === "ACTIVE" &&
    scope.branch.organizationId === organizationId)) {
    return NextResponse.json({ error: "active_branch_scope_required" }, { status: 403 });
  }
  let data;
  try { data = parseCommentRevisionRequest(await request.json().catch(() => null)); }
  catch (error) {
    return NextResponse.json({
      error: error instanceof ClinicalCommentDraftError ? error.reason : "invalid_request",
    }, { status: 400 });
  }
  const context = await requestContext();
  try {
    const revision = await prisma.$transaction(async tx => {
      const organization = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organizations WHERE id = ${organizationId} AND status = 'ACTIVE' FOR UPDATE
      `;
      if (organization.length !== 1) throw new RevisionConflict("organization_inactive", 403);
      const branch = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM branches WHERE id = ${branchId}
        AND organization_id = ${organizationId} AND status = 'ACTIVE' FOR UPDATE
      `;
      const grant = await tx.userBranchScope.findUnique({
        where: { userId_branchId: { userId: session.user.id, branchId } },
        select: { branchId: true },
      });
      if (branch.length !== 1 || !grant) {
        throw new RevisionConflict("active_branch_scope_required", 403);
      }
      const lockedParent = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM result_comment_templates
        WHERE id = ${data.id} AND organization_id = ${organizationId} FOR UPDATE
      `;
      if (lockedParent.length !== 1) throw new RevisionConflict("comment_template_not_found", 404);
      const predecessor = await tx.resultCommentTemplate.findFirst({
        where: { id: data.id, organizationId },
      });
      if (!predecessor) throw new RevisionConflict("comment_template_not_found", 404);
      const existingSuccessor = await tx.resultCommentTemplate.findFirst({
        where: { supersedesTemplateId: predecessor.id }, select: { id: true },
      });
      if (existingSuccessor) throw new RevisionConflict("comment_revision_successor_already_exists");
      let targetActive = predecessor.scope === "ORGANIZATION" &&
        !predecessor.testId && !predecessor.componentId;
      if (predecessor.scope !== "ORGANIZATION" && predecessor.testId) {
        const test = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM lab_tests WHERE id = ${predecessor.testId}
          AND organization_id = ${organizationId} AND status = 'ACTIVE' FOR UPDATE
        `;
        targetActive = test.length === 1 && predecessor.scope === "TEST" && !predecessor.componentId;
        if (test.length === 1 && predecessor.scope === "COMPONENT" && predecessor.componentId) {
          const component = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM test_components WHERE id = ${predecessor.componentId}
            AND test_id = ${predecessor.testId} AND status = 'ACTIVE' FOR UPDATE
          `;
          targetActive = component.length === 1;
        }
      }
      const problem = validateCommentRevisionSource(
        predecessor, data, commentTemplateReviewFingerprint(predecessor), targetActive);
      if (problem) throw new RevisionConflict(problem);
      const nextVersion = predecessor.revisionNumber + 1;
      const code = revisionCode(predecessor.code, nextVersion);
      const created = await tx.resultCommentTemplate.create({ data: {
        organizationId, supersedesTemplateId: predecessor.id, revisionNumber: nextVersion,
        code, scope: predecessor.scope, testId: predecessor.testId,
        componentId: predecessor.componentId,
        nameEn: data.nameEn, nameAr: data.nameAr, textEn: data.textEn, textAr: data.textAr,
        status: "INACTIVE", deactivatedAt: new Date(),
      } });
      await tx.auditEvent.create({ data: {
        organizationId, branchId, actorUserId: session.user.id,
        action: "RESULT_COMMENT_TEMPLATE_REVISION_CREATED",
        entityType: "ResultCommentTemplate", entityId: created.id,
        reason: data.reason,
        oldValues: {
          predecessorId: predecessor.id,
          predecessorCode: predecessor.code,
          predecessorStatus: predecessor.status,
          predecessorFingerprint: data.expectedFingerprint,
          revisionNumber: predecessor.revisionNumber,
        },
        newValues: {
          predecessorId: predecessor.id, code: created.code,
          revisionNumber: created.revisionNumber, scope: created.scope,
          testId: created.testId, componentId: created.componentId,
          status: "INACTIVE", textFingerprint: commentTemplateReviewFingerprint(created),
          clinicalScope: "PENDING_INDEPENDENT_REVIEW",
        },
        ipAddress: context.ipAddress, userAgent: context.userAgent,
      } });
      return created;
    }, { isolationLevel: "Serializable", timeout: 45000 });
    return NextResponse.json({ status: "draft", revision },
      { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof RevisionConflict)
      return NextResponse.json({ error: error.reason }, { status: error.statusCode });
    if (error instanceof ClinicalCommentDraftError)
      return NextResponse.json({ error: error.reason }, { status: 409 });
    return NextResponse.json({ error: "comment_revision_concurrent_conflict" }, { status: 409 });
  }
}
