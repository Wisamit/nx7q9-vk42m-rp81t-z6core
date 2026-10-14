import { NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  LEGACY_ROW_LINEAGE_MAX_BYTES, legacyRowHex, legacyRowUuid,
  legacyLineageDomainPermission, legacyLineageMappingAllowed,
  parseLegacyRowDecision, parseLegacyRowManifest, LegacyLineageError,
} from "@/lib/catalog-legacy-row-lineage";

export const dynamic = "force-dynamic";
const jsonHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: jsonHeaders });
const required = ["catalog.manage", "pricing.manage", "catalog.reference_ranges.manage"] as const;

function authorized(session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>) {
  const perms = permissionSet(session);
  return required.every(code => perms.has(code)) &&
    !!session.activeBranchId && session.user.departmentScopes.length === 0 &&
    session.user.branchScopes.some(grant => grant.branchId === session.activeBranchId &&
      grant.branch.organizationId === session.user.organizationId && grant.branch.status === "ACTIVE");
}
async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || ""))
    throw new LegacyLineageError("lineage_json_required", 415);
  if (request.headers.get("sec-fetch-site") === "cross-site")
    throw new LegacyLineageError("lineage_cross_site_denied", 403);
  const statedLength = Number(request.headers.get("content-length") || "0");
  if (!Number.isFinite(statedLength) || statedLength < 0 || statedLength > maxBytes)
    throw new LegacyLineageError("lineage_payload_too_large", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new LegacyLineageError("lineage_body_missing");
  const parts: Uint8Array[] = []; let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maxBytes) {
      await reader.cancel("lineage_payload_too_large");
      throw new LegacyLineageError("lineage_payload_too_large", 413);
    }
    parts.push(next.value);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(parts))); }
  catch { throw new LegacyLineageError("lineage_invalid_json"); }
}

/** Read-only hashed Access master-row evidence, never a migration/cutover certificate. */
async function inTenantTransaction<T>(
  session: NonNullable<Awaited<ReturnType<typeof getCurrentSession>>>,
  action: (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  // The inferred overloaded Prisma transaction argument is deliberately kept
  // transaction-bound; the organization row lock serializes all decisions.
  return prisma.$transaction(async tx => {
    const org = session.user.organizationId;
    const lock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id=${org} AND status='ACTIVE' FOR UPDATE`;
    if (lock.length !== 1) throw new LegacyLineageError("lineage_organization_inactive", 403);
    const [actor, branch, activeBranches, grants, departments] = await Promise.all([
      tx.user.findFirst({ where: { id: session.user.id, organizationId: org, status: "ACTIVE" },
        select: { id: true, roles: { select: { role: { select: {
          organizationId: true, status: true,
          permissions: { select: { permission: { select: { code: true } } } },
        } } } } } }),
      tx.branch.findFirst({ where: { id: session.activeBranchId!, organizationId: org, status: "ACTIVE" },
        select: { id: true } }),
      tx.branch.count({ where: { organizationId: org, status: "ACTIVE" } }),
      tx.userBranchScope.count({ where: { userId: session.user.id,
        branch: { organizationId: org, status: "ACTIVE" } } }),
      tx.userDepartmentScope.count({ where: { userId: session.user.id } }),
    ]);
    const live = new Set(actor?.roles.filter(r => r.role.organizationId === org &&
      r.role.status === "ACTIVE").flatMap(r => r.role.permissions.map(p => p.permission.code)) ?? []);
    const activeGrant = await tx.userBranchScope.findUnique({ where: {
      userId_branchId: { userId: session.user.id, branchId: session.activeBranchId! },
    }, select: { userId: true } });
    // Whole-database fingerprints and cross-branch mapping review require
    // enterprise-wide staff scope, not only a logged-in single branch.
    if (!required.every(p => live.has(p)) || !branch || !activeGrant ||
        departments !== 0 || grants !== activeBranches)
      throw new LegacyLineageError("lineage_scope_or_permissions_revoked", 403);
    return action(tx);
  }, { timeout: 30000 });
}

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
async function validTarget(tx: Tx, org: string, branchId: string, type: string, id: string) {
  switch (type) {
    case "TEST": return !!await tx.labTest.findFirst({ where: { id, organizationId: org, status: "ACTIVE" }, select: { id: true } });
    case "COMPONENT": return !!await tx.testComponent.findFirst({ where: { id, status: "ACTIVE", test: { organizationId: org, status: "ACTIVE" } }, select: { id: true } });
    case "PANEL": return !!await tx.testPanel.findFirst({ where: { id, organizationId: org, status: "ACTIVE", items: { some: {} } }, select: { id: true } });
    case "PACKAGE": return !!await tx.commercialPackage.findFirst({ where: { id, organizationId: org, status: "ACTIVE", items: { some: {} } }, select: { id: true } });
    case "UNIT": return !!await tx.unit.findFirst({ where: { id, organizationId: org, status: "ACTIVE" }, select: { id: true } });
    case "CONTAINER": return !!await tx.container.findFirst({ where: { id, organizationId: org, status: "ACTIVE" }, select: { id: true } });
    case "REFERENCE_INTERVAL": return !!await tx.referenceInterval.findFirst({ where: {
      id, component: { test: { organizationId: org } },
    }, select: { id: true } });
    case "PRICE_LIST_ITEM": return !!await tx.priceListItem.findFirst({ where: {
      id, test: { organizationId: org }, priceList: {
        organizationId: org, OR: [{ scopeType: "ORGANIZATION", branchId: null },
          { scopeType: "BRANCH", branchId }],
      },
    }, select: { id: true } });
    case "PRICE_LIST_PACKAGE_ITEM": return !!await tx.priceListPackageItem.findFirst({ where: {
      id, package: { organizationId: org }, priceList: {
        organizationId: org, OR: [{ scopeType: "ORGANIZATION", branchId: null },
          { scopeType: "BRANCH", branchId }],
      },
    }, select: { id: true } });
    case "COMMENT_TEMPLATE": return !!await tx.resultCommentTemplate.findFirst({ where: {
      id, organizationId: org,
    }, select: { id: true } });
    case "ORGANISM": return !!await tx.organism.findFirst({ where: { id, organizationId: org }, select: { id: true } });
    case "ANTIBIOTIC": return !!await tx.antibiotic.findFirst({ where: { id, organizationId: org }, select: { id: true } });
    case "REFERRER": return !!await tx.referrer.findFirst({ where: { id, organizationId: org }, select: { id: true } });
    case "SOURCE": return !!await tx.orderSource.findFirst({ where: { id, organizationId: org }, select: { id: true } });
    default: return false;
  }
}

export async function POST(request: Request) {
  const session = await getCurrentSession();
  if (!session) return fail("unauthorized", 401);
  if (!authorized(session)) return fail("lineage_organization_review_permission_required", 403);
  try {
    const manifest = parseLegacyRowManifest(await readJson(request, LEGACY_ROW_LINEAGE_MAX_BYTES));
    const org = session.user.organizationId, ctx = await requestContext();
    const outcome = await inTenantTransaction(session, async tx => {
      const previous = await tx.legacyCatalogRowLineage.findFirst({
        where: { organizationId: org, sourceSha256: manifest.sourceSha256, sourceTable: manifest.tableName },
        select: { sourceSchemaSha256: true },
      });
      if (previous && previous.sourceSchemaSha256 !== manifest.schemaSha256)
        throw new LegacyLineageError("lineage_source_schema_conflict", 409);
      const created = manifest.rows.length ? await tx.legacyCatalogRowLineage.createMany({
        data: manifest.rows.map(row => ({
          organizationId: org, sourceSha256: manifest.sourceSha256,
          sourceSchemaSha256: manifest.schemaSha256, sourceTable: manifest.tableName,
          rowDigest: row.rowDigest, occurrence: row.occurrence,
          createdByUserId: session.user.id,
        })), skipDuplicates: true,
      }) : { count: 0 };
      await tx.auditEvent.create({ data: {
        organizationId: org, branchId: session.activeBranchId,
        actorUserId: session.user.id, action: "LEGACY_MDB_ROW_FINGERPRINTS_STAGED",
        entityType: "LegacyCatalogRowLineage", entityId: manifest.sourceSha256,
        newValues: { tableName: manifest.tableName, sourceRowCountClaim: manifest.sourceRowCount,
          page: manifest.chunkIndex, pageCountClaim: manifest.chunkCount,
          receivedCount: manifest.rows.length, createdCount: created.count,
          sourceIndependentlyVerified: false, valueActivation: false },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return created.count;
    });
    return NextResponse.json({ status: "review_only", created: outcome,
      received: manifest.rows.length, sourceIndependentlyVerified: false,
      clinicalApproved: false, financialApproved: false, activated: false },
    { headers: jsonHeaders });
  } catch (e) {
    if (e instanceof LegacyLineageError) return fail(e.code, e.status);
    throw e;
  }
}

export async function PATCH(request: Request) {
  const session = await getCurrentSession();
  if (!session) return fail("unauthorized", 401);
  if (!authorized(session)) return fail("lineage_organization_review_permission_required", 403);
  try {
    const decision = parseLegacyRowDecision(await readJson(request, 4096));
    const org = session.user.organizationId, ctx = await requestContext();
    const result = await inTenantTransaction(session, async tx => {
      const existing = await tx.legacyCatalogRowLineage.findFirst({
        where: { id: decision.id, organizationId: org },
      });
      if (!existing) throw new LegacyLineageError("lineage_record_not_found", 404);
      if (existing.revision !== decision.expectedRevision ||
          existing.classification === "APPROVED_MAPPING")
        throw new LegacyLineageError("lineage_revision_conflict", 409);
      if (decision.classification === "APPROVED_MAPPING") {
        if (existing.classification !== "MAPPED" || !existing.targetType ||
            !existing.targetId || existing.targetType !== decision.targetType ||
            existing.targetId !== decision.targetId ||
            existing.batchId !== decision.batchId || existing.importRowId !== decision.importRowId ||
            existing.createdByUserId === session.user.id ||
            existing.mappedByUserId === session.user.id)
          throw new LegacyLineageError("independent_mapping_reviewer_required", 403);
      } else if (decision.classification === "MAPPED" &&
                 existing.createdByUserId !== session.user.id) {
        // Staged hashes are not interchangeable: author retains control of
        // unresolved evidence, reviewer only confirms a mapped identity.
        throw new LegacyLineageError("source_row_author_required", 403);
      }
      const targetType = decision.targetType || existing.targetType;
      const targetId = decision.targetId || existing.targetId;
      if ((decision.classification === "MAPPED" || decision.classification === "APPROVED_MAPPING")) {
        if (!targetType || !targetId ||
            !legacyLineageMappingAllowed(existing.sourceTable, targetType) ||
            !await validTarget(tx, org, session.activeBranchId!, targetType, targetId))
          throw new LegacyLineageError("lineage_target_not_authorized_or_missing", 409);
      }
      if (decision.batchId || decision.importRowId) {
        if (!decision.batchId || !decision.importRowId)
          throw new LegacyLineageError("lineage_staged_row_link_incomplete");
        const sourceRow = await tx.catalogImportRow.findFirst({
          where: { id: decision.importRowId, batchId: decision.batchId,
            batch: { organizationId: org, sourceType: "LEGACY_MDB_EXPORT" } },
          select: { id: true, entityType: true, importedEntityId: true },
        });
        if (!sourceRow || sourceRow.entityType !== targetType ||
            sourceRow.importedEntityId && sourceRow.importedEntityId !== targetId)
          throw new LegacyLineageError("lineage_source_target_mismatch", 409);
      }
      const revised = await tx.legacyCatalogRowLineage.updateMany({
        where: { id: existing.id, organizationId: org, revision: decision.expectedRevision,
          classification: existing.classification },
        data: { revision: { increment: 1 }, classification: decision.classification,
          targetType: decision.targetType, targetId: decision.targetId,
          batchId: decision.batchId, importRowId: decision.importRowId,
          reason: decision.reason,
          ...(decision.classification === "APPROVED_MAPPING"
            ? { reviewedByUserId: session.user.id, reviewedAt: new Date() }
            : { mappedByUserId: session.user.id }),
        },
      });
      if (revised.count !== 1) throw new LegacyLineageError("lineage_revision_conflict", 409);
      await tx.auditEvent.create({ data: {
        organizationId: org, branchId: session.activeBranchId, actorUserId: session.user.id,
        action: decision.classification === "APPROVED_MAPPING"
          ? "LEGACY_MDB_MAPPING_INDEPENDENTLY_REVIEWED" : "LEGACY_MDB_ROW_CLASSIFIED",
        entityType: "LegacyCatalogRowLineage", entityId: existing.id,
        oldValues: { revision: existing.revision, classification: existing.classification,
          targetType: existing.targetType, targetId: existing.targetId },
        newValues: { revision: existing.revision + 1, classification: decision.classification,
          targetType: decision.targetType, targetId: decision.targetId,
          importRowId: decision.importRowId, mappingOnly: true, valuesApproved: false,
          activated: false, sourceIndependentlyVerified: false },
        reason: decision.reason, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      } });
      return { revision: existing.revision + 1 };
    });
    return NextResponse.json({ status: "review_only", ...result, mappingOnly: true,
      sourceIndependentlyVerified: false, clinicalApproved: false,
      financialApproved: false, activated: false }, { headers: jsonHeaders });
  } catch (e) {
    if (e instanceof LegacyLineageError) return fail(e.code, e.status);
    throw e;
  }
}

export async function GET(request: Request) {
  const session = await getCurrentSession();
  if (!session) return fail("unauthorized", 401);
  if (!authorized(session)) return fail("lineage_organization_review_permission_required", 403);
  const q = new URL(request.url).searchParams;
  const source = q.get("sourceSha256"), table = q.get("tableName");
  const after = q.get("after") || "0";
  if ([...q.keys()].some(k => !["sourceSha256", "tableName", "after"].includes(k)) ||
      !source || !legacyRowHex.test(source) || !table ||
      !/^(?:0|[1-9][0-9]{0,8})$/.test(after))
    return fail("lineage_query_invalid", 400);
  try {
    const results = await inTenantTransaction(session, async tx => {
      const rows = await tx.legacyCatalogRowLineage.findMany({
        where: { organizationId: session.user.organizationId, sourceSha256: source,
          sourceTable: table }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 101, skip: Number(after),
        select: { id: true, sourceTable: true, sourceSha256: true,
          sourceSchemaSha256: true, rowDigest: true, occurrence: true,
          classification: true, targetType: true, targetId: true, batchId: true,
          importRowId: true, revision: true, reason: true, reviewedAt: true },
      });
      const stats = await tx.legacyCatalogRowLineage.groupBy({
        by: ["classification"], where: { organizationId: session.user.organizationId,
          sourceSha256: source, sourceTable: table }, _count: { _all: true },
      });
      return { rows: rows.slice(0, 100), nextAfter: rows.length > 100 ? Number(after) + 100 : null,
        counts: stats.map(s => ({ classification: s.classification, count: s._count._all })) };
    });
    return NextResponse.json({ ...results, readOnly: true,
      sourceIndependentlyVerified: false, rowParityCertified: false,
      clinicalApproved: false, financialApproved: false, activated: false },
    { headers: jsonHeaders });
  } catch (e) {
    if (e instanceof LegacyLineageError) return fail(e.code, e.status);
    throw e;
  }
}
