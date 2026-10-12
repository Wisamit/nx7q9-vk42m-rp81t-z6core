import { NextResponse } from "next/server";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import {
  commentTemplateReviewFingerprint, commentTransitionError, type CommentTemplateEvidence,
} from "@/lib/comment-template-approval";
import { prisma } from "@/lib/db";

function text(value: unknown, max = 5000) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}
function code(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80);
}

export async function POST(request: Request) {
  const session = await requirePermission("result_comments.manage");
  const ctx = await requestContext();
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const scope = ["ORGANIZATION","TEST","COMPONENT"].includes(body.scope) ? body.scope : "ORGANIZATION";
  const testId = text(body.testId, 36) || null;
  const componentId = text(body.componentId, 36) || null;
  const nameEn = text(body.nameEn, 220);
  const nameAr = text(body.nameAr, 220);
  const textEn = text(body.textEn, 5000);
  const textAr = text(body.textAr, 5000);
  const templateCode = code(text(body.code, 80) || nameEn);

  if (!nameEn || !textEn || !templateCode) return NextResponse.json({ error: "missing_required_fields" }, { status: 400 });
  if (scope === "TEST" && !testId) return NextResponse.json({ error: "test_required" }, { status: 400 });
  if (scope === "COMPONENT" && (!testId || !componentId)) return NextResponse.json({ error: "component_required" }, { status: 400 });

  if (testId) {
    const test = await prisma.labTest.findFirst({
      where: { id: testId, organizationId: session.user.organizationId },
      include: { components: true },
    });
    if (!test) return NextResponse.json({ error: "test_not_found" }, { status: 404 });
    if (componentId && !test.components.some(component => component.id === componentId)) {
      return NextResponse.json({ error: "component_not_belong_to_test" }, { status: 409 });
    }
  }

  try {
    const template = await prisma.$transaction(async (tx) => {
      const created = await tx.resultCommentTemplate.create({
        data: {
          organizationId: session.user.organizationId,
          scope,
          testId: scope === "ORGANIZATION" ? null : testId,
          componentId: scope === "COMPONENT" ? componentId : null,
          code: templateCode,
          nameEn,
          nameAr: nameAr || null,
          textEn,
          textAr: textAr || null,
          // Draft by default: new interpretive text is not pre-approved.
          status: "INACTIVE", deactivatedAt: new Date(),
        },
      });

      await tx.auditEvent.create({
        data: {
          organizationId: session.user.organizationId,
          branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "RESULT_COMMENT_TEMPLATE_CREATED",
          entityType: "ResultCommentTemplate",
          entityId: created.id,
          newValues: { code: templateCode, scope, testId, componentId, nameEn,
            status: "INACTIVE", textFingerprint: commentTemplateReviewFingerprint(created),
          },
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
        },
      });
      return created;
    });
    return NextResponse.json({ status: "ok", template }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "template_code_already_exists" }, { status: 409 });
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
