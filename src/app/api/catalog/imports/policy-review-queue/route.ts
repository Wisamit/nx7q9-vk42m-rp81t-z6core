import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { BUNDLE_REVIEW_SOURCE } from "@/lib/catalog-bundle-review";
import { POLICY_DRAFT_HISTORY_LIMIT } from "@/lib/catalog-policy-draft-history";
import {
  issueSignedPolicyQueueCursor, verifySignedPolicyQueueCursor,
  samePolicyQueueAnchor, samePolicyQueueAuditWatermark,
  POLICY_QUEUE_CURSOR_TTL_MS,
} from "@/lib/catalog-policy-queue-signed-cursor";
import { verifiedPolicyQueueCandidate } from "@/lib/catalog-policy-review-queue-guard";
import { planPolicyQueueDecisionFetch } from "@/lib/catalog-policy-queue-decision-plan";
import { validatePolicyReviewBatchScope } from "@/lib/catalog-policy-review-scope";
import { catalogBundleSigningSecret } from "@/lib/catalog-bundle-attestation";
import {
  POLICY_QUEUE_ENTRY_LIMIT, POLICY_QUEUE_EVENT_WINDOW,
  policyQueueNextPage,
} from "@/lib/catalog-policy-queue-pagination";
import {
  domainReviewPermissions, parsePolicyReviewRecord,
  type PolicyReviewDomain,
} from "@/lib/catalog-policy-draft-review";

export const dynamic = "force-dynamic";

/** Latest active-branch proposals only. No draft contents or actor identities. */
export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const original = permissionSet(session);
  if (!original.has("catalog.manage"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const params = request.nextUrl.searchParams;
  if ([...params.keys()].some(key => key !== "cursor") ||
      [...params.keys()].filter(key => key === "cursor").length > 1)
    return NextResponse.json({ error: "policy_queue_cursor_invalid", }, { status: 400 });
  const secret = catalogBundleSigningSecret(process.env);
  if (!secret) return NextResponse.json({ error: "policy_queue_key_unavailable" }, { status: 503 });
  const token = params.get("cursor");
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
    const grantedBranchIds = branchGrants.filter(item => originalBranches.has(item.branchId))
      .map(item => item.branchId);
    const scope = resolveClinicalImportScope({
      organizationId, activeBranchId: session.activeBranchId, activeBranch: branch,
      branchScopes: grantedBranchIds
        .map(branchId => ({ branchId, branch: { status: "ACTIVE" } })),
      departmentScopes: departmentsNow,
    });
    if (!scope) return { error: "policy_queue_branch_revoked", httpStatus: 403 } as const;
    const signedContext = {
      secret, organizationId, branchId: scope.branchId,
      reviewerUserId: session.user.id,
    };
    const cursorState = verifySignedPolicyQueueCursor(token, signedContext, Date.now());
    if (cursorState === undefined)
      return { error: "policy_queue_cursor_invalid", httpStatus: 400 } as const;
    // Both actions participate in queue eligibility. Count PLUS latest is
    // needed: an append with a backdated occurredAt or a same-ms lower UUID
    // can leave the previous highest-sort event unchanged.
    // Include every actor, not just the current reviewer's peers.
    const draftWhere = {
      organizationId, branchId: scope.branchId,
      action: "CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED",
      entityType: "CatalogImportBatch",
    };
    const reviewWhere = {
      organizationId, branchId: scope.branchId,
      action: "CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED",
      entityType: "CatalogPolicyDraft",
    };
    const [topEvent, draftCount, topReview, reviewCount] = await Promise.all([
      tx.auditEvent.findFirst({ where: draftWhere,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        select: { id: true, occurredAt: true },
      }),
      tx.auditEvent.count({ where: draftWhere }),
      tx.auditEvent.findFirst({ where: reviewWhere,
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        select: { id: true, occurredAt: true },
      }),
      tx.auditEvent.count({ where: reviewWhere }),
    ]);
    const anchor = topEvent ? {
      id: topEvent.id, occurredAt: topEvent.occurredAt,
    } : null;
    const reviewWatermark = {
      latest: topReview ? {
        id: topReview.id, occurredAt: topReview.occurredAt,
      } : null,
      count: reviewCount,
    };
    if (cursorState && (
      !samePolicyQueueAnchor(cursorState.anchor, anchor) ||
      cursorState.draftCount !== draftCount ||
      !samePolicyQueueAuditWatermark(cursorState.reviewWatermark, reviewWatermark)
    )) return { error: "policy_queue_cursor_stale", httpStatus: 409 } as const;
    const cursor = cursorState?.after ?? null;
    const domains: PolicyReviewDomain[] = (["CLINICAL", "FINANCIAL"] as const).filter(
      domain => domainReviewPermissions(domain, original) && domainReviewPermissions(domain, live),
    );
    if (!domains.length) return { entries: [], hasMore: false, nextCursor: null } as const;
    const latestEvents = await tx.auditEvent.findMany({
      where: { organizationId, branchId: scope.branchId,
        action: "CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED",
        entityType: "CatalogImportBatch", actorUserId: { not: session.user.id },
        ...(cursor ? { OR: [
          { occurredAt: { lt: cursor.occurredAt } },
          { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
        ] } : {}),
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: POLICY_QUEUE_EVENT_WINDOW + 1, select: {
        id: true, entityId: true, actorUserId: true, newValues: true, occurredAt: true,
      },
    });
    // One bounded candidate window per request. Overflow is a page, not a
    // terminal error; prior draft revisions never become visible as current.
    const windowEvents = latestEvents.slice(0, POLICY_QUEUE_EVENT_WINDOW);
    const latestByBatch = new Map<string, typeof windowEvents[number]>();
    for (const event of windowEvents)
      if (!latestByBatch.has(event.entityId)) latestByBatch.set(event.entityId, event);
    const batches = await tx.catalogImportBatch.findMany({
      where: {
        organizationId, id: { in: [...latestByBatch.keys()] },
        sourceType: BUNDLE_REVIEW_SOURCE, status: "DRAFT",
        createdByUserId: { not: session.user.id },
      },
      select: { id: true, sourceChecksum: true, createdByUserId: true, summary: true },
    });
    const draftIds = [...latestByBatch.values()].map(event => event.id);
    // Count by draft id *across all branches in the organization*. A single
    // invalid draft with >2 decisions cannot poison unrelated queue entries.
    const decisionWhere = { organizationId,
      action: "CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED",
      entityType: "CatalogPolicyDraft",
    };
    const decisionCounts = draftIds.length ? await tx.auditEvent.groupBy({
      by: ["entityId"],
      where: { ...decisionWhere, entityId: { in: draftIds } },
      _count: { _all: true },
    }) : [];
    const decisionPlan = planPolicyQueueDecisionFetch(draftIds, decisionCounts);
    if (!decisionPlan)
      return { error: "policy_queue_decision_integrity_error", httpStatus: 409 } as const;
    const decisions = decisionPlan.safeDraftIds.length ? await tx.auditEvent.findMany({
      where: { ...decisionWhere, entityId: { in: decisionPlan.safeDraftIds } },
      select: { entityId: true, actorUserId: true, branchId: true, newValues: true },
      take: decisionPlan.maxRows,
    }) : [];
    if (decisions.length >= decisionPlan.maxRows && decisionPlan.safeDraftIds.length)
      return { error: "policy_queue_decision_snapshot_inconsistent", httpStatus: 409 } as const;
    const decisionByDraft = new Map<string, typeof decisions>();
    for (const decision of decisions) {
      if (!decisionPlan.safeDraftIds.includes(decision.entityId))
        return { error: "policy_queue_decision_snapshot_inconsistent", httpStatus: 409 } as const;
      const bucket = decisionByDraft.get(decision.entityId) ?? [];
      bucket.push(decision);
      decisionByDraft.set(decision.entityId, bucket);
    }
    const entries: Array<{
      batchId: string; draftEventId: string; revision: number;
      recordedAt: string; domains: PolicyReviewDomain[];
    }> = [];
    const batchById = new Map(batches.map(batch => [batch.id, batch]));
    let lastScanned: (typeof windowEvents)[number] | null = null;
    for (const event of latestByBatch.values()) {
      lastScanned = event;
      const batch = batchById.get(event.entityId);
      if (!batch || !batch.sourceChecksum || event.actorUserId !== batch.createdByUserId) continue;
      // Do not list a seemingly valid latest revision if another actor,
      // missing revision, or corrupted prior AuditEvent poisons its chain.
      const allRevisions = await tx.auditEvent.findMany({
        where: { organizationId,
          action: "CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED",
          entityType: "CatalogImportBatch", entityId: batch.id },
        orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
        take: POLICY_DRAFT_HISTORY_LIMIT + 1,
        select: { id: true, actorUserId: true, branchId: true, newValues: true },
      });
      const verified = verifiedPolicyQueueCandidate({
        events: allRevisions, candidateEventId: event.id,
        organizationId, branchId: scope.branchId, batchId: batch.id,
        sourceChecksum: batch.sourceChecksum, authorUserId: batch.createdByUserId,
      });
      if (!verified?.draft) continue;
      const draft = verified.draft;
      if (decisionPlan.corruptDraftIds.has(event.id)) continue;
      const decided = decisionByDraft.get(event.id) ?? [];
      if (decided.length !== (decisionPlan.expectedCounts.get(event.id) ?? 0))
        continue;
      if (decided.some(d => d.branchId !== scope.branchId)) continue;
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
      // Discovery itself must enforce the same full 5,000-row live-master
      // branch/department scope gate as independent GET preflight and POST.
      const batchScope = await validatePolicyReviewBatchScope(tx, {
        batchId: batch.id, scope, grantedBranchIds,
        sourceChecksum: batch.sourceChecksum, authorUserId: batch.createdByUserId,
        stageEvidenceSeal: batch.summary && typeof batch.summary === "object" &&
          !Array.isArray(batch.summary) ? batch.summary.stageEvidenceSeal : null,
        signingSecret: catalogBundleSigningSecret(process.env),
      });
      if (!batchScope.ok) continue;
      entries.push({
        batchId: batch.id, draftEventId: event.id, revision: draft.revision,
        recordedAt: event.occurredAt.toISOString(), domains: eligible,
      });
      if (entries.length >= POLICY_QUEUE_ENTRY_LIMIT) break;
    }
    // If the page contains no eligible batches, advance past the full
    // scanned window so hidden/corrupt events cannot trap pagination.
    if (entries.length < POLICY_QUEUE_ENTRY_LIMIT && windowEvents.length)
      lastScanned = windowEvents[windowEvents.length - 1];
    const page = policyQueueNextPage({
      window: windowEvents, lastScanned,
      overflow: latestEvents.length > POLICY_QUEUE_EVENT_WINDOW,
    });
    // The continuation is signed for the *current* reviewer, organization
    // and branch. Never return a raw positional cursor to the browser.
    const nextCursor = page.hasMore && lastScanned && anchor
      ? issueSignedPolicyQueueCursor({
          ...signedContext, after: {
            id: lastScanned.id, occurredAt: lastScanned.occurredAt,
          }, anchor, draftCount, reviewWatermark,
          expiresAt: cursorState?.expiresAt ?? Date.now() + POLICY_QUEUE_CURSOR_TTL_MS,
        }) : null;
    return { entries, hasMore: Boolean(nextCursor), nextCursor } as const;
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
