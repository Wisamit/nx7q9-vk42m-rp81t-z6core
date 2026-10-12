import { NextResponse } from "next/server";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import {
  commentTemplateReviewFingerprint, commentTransitionError, type CommentTemplateEvidence,
} from "@/lib/comment-template-approval";
import { prisma } from "@/lib/db";
import { ClinicalCommentDraftError, parseClinicalCommentDraft } from "@/lib/comment-template-draft";

export async function POST(request: Request) {
  const session = await requirePermission("result_comments.manage");
  const organizationId = session.user.organizationId;
  const branchId = session.activeBranchId;
  if (!branchId || !session.user.branchScopes.some(scope =>
    scope.branchId === branchId && scope.branch.status === "ACTIVE" &&
    scope.branch.organizationId === organizationId)) {
    return NextResponse.json({ error: "active_branch_scope_required" }, { status: 403 });
  }
  let draft;
  try { draft = parseClinicalCommentDraft(await request.json().catch(() => null)); }
  catch (error) {
    return NextResponse.json({
      error: error instanceof ClinicalCommentDraftError ? error.reason : "invalid_request",
    }, { status: 400 });
  }
  const ctx = await requestContext();
  try {
    const template = await prisma.$transaction(async tx => {
      const org = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organizations WHERE id = ${organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      if (org.length !== 1) throw new CommentTransitionConflict("organization_inactive", 403);
      const branch = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM branches WHERE id = ${branchId}
        AND organization_id = ${organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      const grant = await tx.userBranchScope.findUnique({
        where: { userId_branchId: { userId: session.user.id, branchId } },
        select: { branchId: true },
      });
      if (branch.length !== 1 || !grant) {
        throw new CommentTransitionConflict("active_branch_scope_required", 403);
      }
      if (draft.scope !== "ORGANIZATION") {
        const tests = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM lab_tests WHERE id = ${draft.testId}
          AND organization_id = ${organizationId} AND status = 'ACTIVE' FOR UPDATE
        `;
        if (tests.length !== 1) throw new CommentTransitionConflict("comment_draft_test_inactive_or_not_found");
      }
      if (draft.scope === "COMPONENT") {
        const components = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM test_components WHERE id = ${draft.componentId}
          AND test_id = ${draft.testId} AND status = 'ACTIVE' FOR UPDATE
        `;
        if (components.length !== 1) {
          throw new CommentTransitionConflict("comment_draft_component_inactive_or_wrong_test");
        }
      }
      const created = await tx.resultCommentTemplate.create({
        data: { organizationId, scope: draft.scope,
          testId: draft.testId, componentId: draft.componentId,
          code: draft.code, nameEn: draft.nameEn, nameAr: draft.nameAr,
          textEn: draft.textEn, textAr: draft.textAr,
          status: "INACTIVE", deactivatedAt: new Date(),
        },
      });
      await tx.auditEvent.create({ data: {
        organizationId, branchId, actorUserId: session.user.id,
        action: "RESULT_COMMENT_TEMPLATE_CREATED",
        entityType: "ResultCommentTemplate", entityId: created.id,
        newValues: {
          code: draft.code, scope: draft.scope, testId: draft.testId,
          componentId: draft.componentId, nameEn: draft.nameEn, nameAr: draft.nameAr,
          status: "INACTIVE", textFingerprint: commentTemplateReviewFingerprint(created),
          reviewRequired: "INDEPENDENT_CLINICAL_APPROVER",
        },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return created;
    }, { isolationLevel: "Serializable", timeout: 45000 });
    return NextResponse.json({ status: "ok", template }, { status: 201,
      headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CommentTransitionConflict) {
      return NextResponse.json({ error: error.code }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "comment_draft_conflict_or_lock_failed" }, { status: 409 });
  }
}

class CommentTransitionConflict extends Error {
  constructor(readonly code: string, readonly statusCode = 409) { super(code); }
}

export async function PATCH(request: Request) {
  const session = await requirePermission("result_comments.manage");
  const permissions = permissionSet(session);
  const ctx = await requestContext();
  const input: unknown = await request.json().catch(() => null);
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const body = input as Record<string, unknown>;
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const status = body.status === "ACTIVE" ? "ACTIVE" : body.status === "INACTIVE" ? "INACTIVE" : null;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const expectedFingerprint = typeof body.expectedFingerprint === "string" ? body.expectedFingerprint : "";
  const confirmation = typeof body.confirmation === "string" ? body.confirmation : null;
  if (!/^[a-f0-9-]{36}$/i.test(id) || !status) {
    return NextResponse.json({ error: "invalid_status_change" }, { status: 400 });
  }
  if (status === "ACTIVE" && !permissions.has("clinical_rules.approve")) {
    return NextResponse.json({ error: "clinical_approval_permission_required" }, { status: 403 });
  }
  const branchId = session.activeBranchId;
  if (!branchId || !session.user.branchScopes.some(scope =>
    scope.branchId === branchId && scope.branch.status === "ACTIVE" &&
    scope.branch.organizationId === session.user.organizationId)) {
    return NextResponse.json({ error: "active_branch_scope_required" }, { status: 403 });
  }
  const organizationId = session.user.organizationId;
  try {
    const updated = await prisma.$transaction(async tx => {
      // Lock the same tenant root that catalog administration locks. Row-level
      // locking protects the comment status and review evidence from two approvers.
      const organization = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organizations WHERE id = ${organizationId} AND status = 'ACTIVE' FOR UPDATE
      `;
      if (organization.length !== 1) throw new CommentTransitionConflict("organization_inactive", 403);
      const branch = await tx.branch.findFirst({
        where: { id: branchId, organizationId, status: "ACTIVE" }, select: { id: true },
      });
      const grant = await tx.userBranchScope.findUnique({
        where: { userId_branchId: { userId: session.user.id, branchId } },
        select: { branchId: true },
      });
      if (!branch || !grant) throw new CommentTransitionConflict("active_branch_scope_required", 403);
      const lock = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM result_comment_templates
        WHERE id = ${id} AND organization_id = ${organizationId} FOR UPDATE
      `;
      if (lock.length !== 1) throw new CommentTransitionConflict("comment_template_not_found", 404);
      const template = await tx.resultCommentTemplate.findFirst({ where: { id, organizationId } });
      if (!template) throw new CommentTransitionConflict("comment_template_not_found", 404);

      const creation = await tx.auditEvent.findFirst({
        where: { organizationId, entityId: id,
          OR: [
            { entityType: "COMMENT_TEMPLATE", action: "LEGACY_MASTER_RECORD_CREATED" },
            { entityType: "ResultCommentTemplate", action: "RESULT_COMMENT_TEMPLATE_CREATED" },
          ],
        },
        orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        select: { actorUserId: true },
      });
      let targetIsActive = template.scope === "ORGANIZATION";
      if (status === "ACTIVE" && template.scope !== "ORGANIZATION" && template.testId) {
        const tests = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT id FROM lab_tests WHERE id = ${template.testId}
          AND organization_id = ${organizationId} AND status = 'ACTIVE' FOR UPDATE
        `;
        targetIsActive = tests.length === 1 && template.scope === "TEST";
        if (tests.length === 1 && template.scope === "COMPONENT" && template.componentId) {
          const components = await tx.$queryRaw<Array<{ id: string }>>`
            SELECT id FROM test_components WHERE id = ${template.componentId}
            AND test_id = ${template.testId} AND status = 'ACTIVE' FOR UPDATE
          `;
          targetIsActive = components.length === 1;
        }
      }
      const current = template as CommentTemplateEvidence;
      const failure = commentTransitionError(current,
        { status, reason, expectedFingerprint, confirmation },
        creation?.actorUserId ?? null, session.user.id, targetIsActive);
      if (failure) throw new CommentTransitionConflict(failure);
      const claimed = await tx.resultCommentTemplate.updateMany({
        where: { id, organizationId, status: template.status, updatedAt: template.updatedAt },
        data: { status, deactivatedAt: status === "INACTIVE" ? new Date() : null },
      });
      if (claimed.count !== 1) throw new CommentTransitionConflict("comment_template_state_changed");
      const latest = await tx.resultCommentTemplate.findUniqueOrThrow({ where: { id } });
      const auditAction = status === "ACTIVE"
        ? "RESULT_COMMENT_TEMPLATE_CLINICALLY_APPROVED"
        : "RESULT_COMMENT_TEMPLATE_DEACTIVATED";
      await tx.auditEvent.create({ data: {
        organizationId, branchId, actorUserId: session.user.id,
        action: auditAction, entityType: "ResultCommentTemplate", entityId: id,
        oldValues: { status: template.status, fingerprint: expectedFingerprint },
        newValues: {
          status, code: template.code, scope: template.scope,
          testId: template.testId, componentId: template.componentId,
          approvedBy: status === "ACTIVE" ? session.user.id : null,
          creatorUserId: creation?.actorUserId ?? null,
          textFingerprint: commentTemplateReviewFingerprint(latest),
        },
        reason, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return latest;
    }, { isolationLevel: "Serializable", timeout: 45000 });
    return NextResponse.json({ status: "ok", template: updated },
      { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof CommentTransitionConflict) {
      return NextResponse.json({ error: error.code }, { status: error.statusCode });
    }
    return NextResponse.json({ error: "comment_template_concurrent_change_or_lock_conflict" }, { status: 409 });
  }
}
