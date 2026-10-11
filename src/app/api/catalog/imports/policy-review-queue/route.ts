import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { BUNDLE_REVIEW_SOURCE } from "@/lib/catalog-bundle-review";
import {
  domainReviewPermissions, parsePolicyReviewRecord, policyDraftFromHistory,
  type PolicyReviewDomain,
} from "@/lib/catalog-policy-draft-review";

export const dynamic = "force-dynamic";

/** Latest active-branch proposals only. No draft contents or actor identities. */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const original = permissionSet(session);
  if (!original.has("catalog.manage"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const organizationId = session.user.organizationId;
  const result = await prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id = ${organizationId} AND status='ACTIVE' FOR UPDATE
    `;
    if (!locked.length) return { error: "policy_queue_organization_inactive", httpStatus: 403 } as const;
    const user = await tx.user.findFirst({
      where: { id: session.user.id, organizationId, status: "ACTIVE" },
      select: { roles: { include: { role: { include: {
        permissions: { include: { permission: true } },
      } } } } },
    });
    const live = new Set(user?.roles.filter(item =>
      item.role.status === "ACTIVE" && item.role.organizationId === organizationId
    ).flatMap(item => item.role.permissions.map(p => p.permission.code)) || []);
    if (!original.has("catalog.manage") || !live.has("catalog.manage"))
      return { error: "policy_queue_permission_revoked", httpStatus: 403 } as const;
    const branch = await tx.branch.findFirst({
      where: { id: session.activeBranchId || "", organizationId, status: "ACTIVE" },
      select: { id: true, status: true, organizationId: true },
    });
    const branchGrants = await tx.userBranchScope.findMany({
      where: { userId: session.user.id, branch: { organizationId, status: "ACTIVE" } },
      select: { branchId: true },
    });
    const originalBranches = new Set(session.user.branchScopes.filter(item =>
      item.branch.organizationId === organizationId && item.branch.status === "ACTIVE"
    ).map(item => item.branchId));
    const departments = await tx.userDepartmentScope.findMany({
      where: { userId: session.user.id },
      select: { departmentId: true, department: {
        select: { organizationId: true, branchId: true, status: true },
      } },
    });
    const originalDepartments = new Set(session.user.departmentScopes.map(item => item.departmentId));
    const restricted = session.user.departmentScopes.length > 0;
    const departmentsNow = restricted
      ? departments.filter(item => originalDepartments.has(item.departmentId))
      : departments;
    if (restricted && !departmentsNow.length)
      return { error: "policy_queue_department_revoked", httpStatus: 403 } as const;
    const scope = resolveClinicalImportScope({
      organizationId, activeBranchId: session.activeBranchId, activeBranch: branch,
      branchScopes: branchGrants.filter(item => originalBranches.has(item.branchId))
        .map(item => ({ branchId: item.branchId, branch: { status: "ACTIVE" } })),
      departmentScopes: departmentsNow,
    });
    if (!scope) return { error: "policy_queue_branch_revoked", httpStatus: 403 } as const;
    const domains: PolicyReviewDomain[] = (["CLINICAL", "FINANCIAL"] as const).filter(
      domain => domainReviewPermissions(domain, original) && domainReviewPermissions(domain, live),
    );
    if (!domains.length) return { entries: [], hasMore: false } as const;
    const latestEvents = await tx.auditEvent.findMany({
      where: { organizationId, branchId: scope.branchId,
        action: "CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED",
        entityType: "CatalogImportBatch", actorUserId: { not: session.user.id } },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: 101, select: {
        id: true, entityId: true, actorUserId: true, newValues: true, occurredAt: true,
      },
    });
    if (latestEvents.length > 100)
      return { error: "policy_queue_history_limit_exceeded", httpStatus: 409 } as const;
    const latestByBatch = new Map<string, typeof latestEvents[number]>();
    for (const event of latestEvents)
      if (!latestByBatch.has(event.entityId)) latestByBatch.set(event.entityId, event);
    const batches = await tx.catalogImportBatch.findMany({
      where: {
        organizationId, id: { in: [...latestByBatch.keys()] },
        sourceType: BUNDLE_REVIEW_SOURCE, status: "DRAFT",
        createdByUserId: { not: session.user.id },
      },
      select: { id: true, sourceChecksum: true, createdByUserId: true },
    });
    const draftIds = [...latestByBatch.values()].map(event => event.id);
    const decisions = draftIds.length ? await tx.auditEvent.findMany({
      where: { organizationId, branchId: scope.branchId,
        action: "CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED",
        entityType: "CatalogPolicyDraft", entityId: { in: draftIds } },
      select: { entityId: true, actorUserId: true, newValues: true },
      take: 201,
    }) : [];
    if (decisions.length > 200)
      return { error: "policy_queue_decision_limit_exceeded", httpStatus: 409 } as const;
    const entries: Array<{
      batchId: string; draftEventId: string; revision: number;
      recordedAt: string; domains: PolicyReviewDomain[];
    }> = [];
    for (const batch of batches) {
      const event = latestByBatch.get(batch.id);
      if (!event || !batch.sourceChecksum || event.actorUserId !== batch.createdByUserId) continue;
      const draft = policyDraftFromHistory(event.newValues, {
        organizationId, batchId: batch.id, branchId: scope.branchId,
        sourceChecksum: batch.sourceChecksum,
      });
      if (!draft) continue;
      const decided = decisions.filter(d => d.entityId === event.id);
      const parsed = decided.map(d => ({
        actorUserId: d.actorUserId, review: parsePolicyReviewRecord(d.newValues, {
          draftEventId: event.id, draft,
        }),
      }));
      if (parsed.some(d => !d.review || !d.actorUserId ||
          d.actorUserId === batch.createdByUserId) ||
          new Set(parsed.map(d => d.review?.domain)).size !== parsed.length ||
          new Set(parsed.map(d => d.actorUserId)).size !== parsed.length) continue;
      const eligible = domains.filter(domain =>
        !parsed.some(d => d.review?.domain === domain) &&
        !parsed.some(d => d.actorUserId === session.user.id));
      if (!eligible.length) continue;
      entries.push({
        batchId: batch.id, draftEventId: event.id, revision: draft.revision,
        recordedAt: event.occurredAt.toISOString(), domains: eligible,
      });
      if (entries.length >= 30) break;
    }
    return { entries, hasMore: latestEvents.length === 100 } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  if ("error" in result)
    return NextResponse.json({ error: result.error }, {
      status: result.httpStatus, headers: { "Cache-Control": "private, no-store" },
    });
  return NextResponse.json({ ...result, approval: false, signingEnabled: false,
    activation: false, liveWrites: false }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
