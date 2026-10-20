import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { BUNDLE_REVIEW_SOURCE, BUNDLE_REVIEW_MAX_ROWS } from "@/lib/catalog-bundle-review";
import { catalogBundleSigningSecret } from "@/lib/catalog-bundle-attestation";
import { reviewStageBatchMetadata } from "@/lib/catalog-review-stage-evidence";
import { verifyIndependentExpertStage } from "@/lib/catalog-expert-stage-integrity";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { bundleTriageClass, triagePermissionScope } from "@/lib/catalog-drift-triage";

export const dynamic = "force-dynamic";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Minimal, live-scoped queue. No source JSON, medical values or prices leave this API. */
export async function GET() {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sessionPermissions = permissionSet(session);
  if (!sessionPermissions.has("catalog.manage"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const organizationId = session.user.organizationId;
  const signingSecret = catalogBundleSigningSecret(process.env);
  if (!signingSecret)
    return NextResponse.json({ error: "expert_queue_stage_key_unavailable" }, { status: 503 });
  const response = await prisma.$transaction(async tx => {
    const locked = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id = ${organizationId} AND status = 'ACTIVE' FOR UPDATE
    `;
    if (locked.length !== 1) return { error: "review_organization_inactive", status: 403 } as const;
    const liveUser = await tx.user.findFirst({
      where: { id: session.user.id, organizationId, status: "ACTIVE" },
      select: { roles: { include: {
        role: { include: { permissions: { include: { permission: true } } } },
      } } },
    });
    const currentPermissions = new Set(liveUser?.roles.filter(item =>
      item.role.status === "ACTIVE" && item.role.organizationId === organizationId
    ).flatMap(item => item.role.permissions.map(grant => grant.permission.code)) || []);
    if (!currentPermissions.has("catalog.manage"))
      return { error: "review_permission_revoked", status: 403 } as const;

    const branch = await tx.branch.findFirst({
      where: { id: session.activeBranchId || "", organizationId, status: "ACTIVE" },
      select: { id: true, organizationId: true, status: true },
    });
    const liveBranches = await tx.userBranchScope.findMany({
      where: { userId: session.user.id, branch: { organizationId, status: "ACTIVE" } },
      select: { branchId: true },
    });
    const initialBranches = new Set(session.user.branchScopes
      .filter(item => item.branch.organizationId === organizationId && item.branch.status === "ACTIVE")
      .map(item => item.branchId));
    const branchIds = liveBranches.map(item => item.branchId).filter(id => initialBranches.has(id));
    const liveDepartments = await tx.userDepartmentScope.findMany({
      where: { userId: session.user.id },
      select: { departmentId: true, department: {
        select: { organizationId: true, branchId: true, status: true },
      } },
    });
    const originalDepartmentIds = new Set(session.user.departmentScopes.map(item => item.departmentId));
    const restricted = session.user.departmentScopes.length > 0;
    const departments = restricted
      ? liveDepartments.filter(item => originalDepartmentIds.has(item.departmentId))
      : liveDepartments;
    if (restricted && !departments.length)
      return { error: "review_department_revoked", status: 403 } as const;
    const scope = resolveClinicalImportScope({
      organizationId, activeBranchId: session.activeBranchId, activeBranch: branch,
      branchScopes: branchIds.map(branchId => ({ branchId, branch: { status: "ACTIVE" } })),
      departmentScopes: departments,
    });
    if (!scope) return { error: "review_scope_revoked", status: 403 } as const;
    const testScope = { ...clinicalImportTestWhere(scope), status: undefined };
    const priceScope = { organizationId, OR: [
      { scopeType: "ORGANIZATION" as const, branchId: null },
      { scopeType: "BRANCH" as const, branchId: { in: branchIds } },
    ] };

    const flags = await tx.auditEvent.findMany({
      where: {
        organizationId, branchId: scope.branchId,
        action: "CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED",
        entityType: "CatalogImportRow", actorUserId: { not: session.user.id },
      },
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }], take: 100,
      select: { id: true, entityId: true, actorUserId: true, newValues: true, occurredAt: true },
    });
    if (!flags.length) return { entries: [], hasMore: false } as const;
    const decisions = await tx.auditEvent.findMany({
      where: { organizationId, action: "CATALOG_BUNDLE_EXPERT_DECISION_RECORDED",
        entityType: "CatalogExpertReviewFlag", entityId: { in: flags.map(flag => flag.id) } },
      select: { entityId: true },
    });
    const decided = new Set(decisions.map(item => item.entityId));
    const candidateRows = await tx.catalogImportRow.findMany({
      where: { id: { in: flags.map(flag => flag.entityId) } },
      select: { id: true, batchId: true, rowNumber: true, entityType: true, normalizedData: true },
    });
    const rowById = new Map(candidateRows.map(row => [row.id, row]));
    const batches = await tx.catalogImportBatch.findMany({
      where: {
        id: { in: [...new Set(candidateRows.map(row => row.batchId))] }, organizationId,
        sourceType: BUNDLE_REVIEW_SOURCE, status: "DRAFT",
        createdByUserId: { not: session.user.id },
      },
      select: { id: true, createdByUserId: true, sourceType: true,
        sourceName: true, status: true, sourceChecksum: true, summary: true },
    });

    // The queue must not offer a pending expert decision for a DRAFT which
    // independent GET/PUT will reject due to a changed staging envelope.
    // Read *all* staged rows, not only the flagged row, and bound the total
    // SQL JSON materialization to one maximum-size bundle per queue request.
    const batchIndex = new Map(batches.map(batch => [batch.id, batch]));
    const orderedBatchIds: string[] = [];
    for (const flag of flags) {
      const id = rowById.get(flag.entityId)?.batchId;
      if (id && batchIndex.has(id) && !orderedBatchIds.includes(id))
        orderedBatchIds.push(id);
    }
    const counts = orderedBatchIds.length ? await tx.catalogImportRow.groupBy({
      by: ["batchId"], where: { batchId: { in: orderedBatchIds } },
      _count: { _all: true },
    }) : [];
    const rowCounts = new Map(counts.map(item => [item.batchId, item._count._all]));
    let budget = 0;
    let evidenceTruncated = false;
    const stageBatchIds: string[] = [];
    for (const id of orderedBatchIds) {
      const count = rowCounts.get(id) || 0;
      if (count < 1 || count > BUNDLE_REVIEW_MAX_ROWS) continue;
      if (budget + count > BUNDLE_REVIEW_MAX_ROWS) {
        evidenceTruncated = true; continue;
      }
      budget += count;
      stageBatchIds.push(id);
    }
    const evidenceRows = stageBatchIds.length ? await tx.catalogImportRow.findMany({
      where: { batchId: { in: stageBatchIds } },
      orderBy: [{ batchId: "asc" }, { rowNumber: "asc" }],
      take: BUNDLE_REVIEW_MAX_ROWS + 1,
      select: {
        id: true, batchId: true, rowNumber: true, entityType: true,
        legacyKey: true, status: true, sourceData: true,
        normalizedData: true, validationIssues: true,
        importedEntityId: true,
      },
    }) : [];
    if (evidenceRows.length !== budget)
      return { error: "expert_queue_staging_snapshot_changed", status: 409 } as const;
    const rowsByBatch = new Map<string, typeof evidenceRows>();
    for (const row of evidenceRows) {
      const group = rowsByBatch.get(row.batchId) || [];
      group.push(row);
      rowsByBatch.set(row.batchId, group);
    }
    const verifiedBatches = new Map<string, typeof batches[number]>();
    for (const id of stageBatchIds) {
      const batch = batchIndex.get(id);
      const rows = rowsByBatch.get(id);
      if (!batch || !batch.sourceChecksum || !rows ||
          rows.length !== rowCounts.get(id)) continue;
      const result = verifyIndependentExpertStage({
        context: {
          organizationId, batchId: id, authorUserId: batch.createdByUserId,
          sourceChecksum: batch.sourceChecksum, rows,
        },
        metadata: reviewStageBatchMetadata(batch),
        seal: object(batch.summary)?.stageEvidenceSeal,
        secret: signingSecret,
      });
      if (result.ok) verifiedBatches.set(id, batch);
    }
    // An empty queue is safer than presenting a forged or non-atomic source.
    const batchById = verifiedBatches;
    const seenRows = new Set<string>();
    const entries: Array<{
      flagEventId: string; batchId: string; rowNumber: number; entityType: string;
      category: string; reasonCode: string; flaggedAt: string;
    }> = [];
    for (const flag of flags) {
      if (seenRows.has(flag.entityId)) continue;
      seenRows.add(flag.entityId);
      if (decided.has(flag.id)) continue;
      const data = object(flag.newValues), row = rowById.get(flag.entityId);
      const batch = row && batchById.get(row.batchId);
      if (!row || !batch || flag.actorUserId !== batch.createdByUserId ||
          data?.batchId !== batch.id || data?.rowNumber !== row.rowNumber ||
          data?.entityType !== row.entityType || typeof data?.reasonCode !== "string" ||
          typeof data?.evidenceToken !== "string") continue;
      const category = bundleTriageClass(row.entityType);
      if (!category || data.category !== category ||
          !triagePermissionScope(category, sessionPermissions) ||
          !triagePermissionScope(category, currentPermissions)) continue;
      const normalized = object(row.normalizedData);
      if (!normalized || typeof normalized.id !== "string" || !UUID.test(normalized.id)) continue;
      if (normalized.branchId !== null && normalized.branchId !== undefined &&
          (typeof normalized.branchId !== "string" || !branchIds.includes(normalized.branchId))) continue;
      let inScope = false;
      if (row.entityType === "TEST")
        inScope = await tx.labTest.count({ where: { ...testScope, id: normalized.id } }) === 1;
      else if (row.entityType === "COMPONENT")
        inScope = await tx.testComponent.count({ where: { id: normalized.id, test: testScope } }) === 1;
      else if (row.entityType === "REFERENCE_INTERVAL")
        inScope = await tx.referenceInterval.count({ where: {
          id: normalized.id, component: { test: testScope },
          OR: [{ branchId: null }, { branchId: { in: branchIds } }],
        } }) === 1;
      else if (row.entityType === "UNIT")
        inScope = await tx.unit.count({ where: { id: normalized.id, organizationId } }) === 1;
      else if (row.entityType === "PRICE_LIST")
        inScope = await tx.priceList.count({ where: { ...priceScope, id: normalized.id } }) === 1;
      else if (row.entityType === "PRICE_LIST_ITEM")
        inScope = await tx.priceListItem.count({ where: {
          id: normalized.id, priceList: priceScope, test: testScope,
        } }) === 1;
      if (!inScope) continue;
      entries.push({
        flagEventId: flag.id, batchId: batch.id, rowNumber: row.rowNumber,
        entityType: row.entityType, category, reasonCode: data.reasonCode,
        flaggedAt: flag.occurredAt.toISOString(),
      });
      if (entries.length >= 30) break;
    }
    return { entries, hasMore: flags.length === 100 || evidenceTruncated } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  if ("error" in response) return NextResponse.json({ error: response.error },
    { status: response.status, headers: { "Cache-Control": "private, no-store" } });
  return NextResponse.json({ ...response, approval: false, application: false },
    { headers: { "Cache-Control": "private, no-store" } });
}
