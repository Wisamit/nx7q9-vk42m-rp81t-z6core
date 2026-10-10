import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { BUNDLE_REVIEW_SOURCE, BUNDLE_REVIEW_MAX_ROWS } from "@/lib/catalog-bundle-review";
import { catalogBundleDrift } from "@/lib/catalog-bundle-drift";
import { catalogExportTypes, type CatalogExportType } from "@/lib/catalog-configuration-export";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ordered: CatalogExportType[] = [
  "TEST", "COMPONENT", "UNIT", "REFERENCE_INTERVAL", "PRICE_LIST", "PRICE_LIST_ITEM",
];
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** A bounded, live-scoped snapshot diff. No source or live values in response. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const sessionPermissions = permissionSet(session);
  if (!sessionPermissions.has("catalog.manage"))
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const afterText = request.nextUrl.searchParams.get("after") || "0";
  if (!/^(?:0|[1-9]\d{0,8})$/.test(afterText))
    return NextResponse.json({ error: "invalid_reconciliation_cursor" }, { status: 400 });
  const after = Number(afterText);
  const { id: batchId } = await params;
  if (!UUID.test(batchId)) return NextResponse.json({ error: "bundle_review_not_found" }, { status: 404 });
  const organizationId = session.user.organizationId;
  const ctx = await requestContext();

  const outcome = await prisma.$transaction(async tx => {
    // Coordinate with existing same-tenant staged/master writers before live auth.
    const orgLock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id = ${organizationId} AND status='ACTIVE' FOR UPDATE
    `;
    if (orgLock.length !== 1) return { error: "reconciliation_organization_inactive", httpStatus: 403 } as const;
    const batch = await tx.catalogImportBatch.findFirst({
      where: { id: batchId, organizationId, sourceType: BUNDLE_REVIEW_SOURCE,
        createdByUserId: session.user.id, status: "DRAFT" },
      select: { id: true, sourceChecksum: true, summary: true },
    });
    if (!batch || !batch.sourceChecksum)
      return { error: "bundle_review_not_found", httpStatus: 404 } as const;

    // Require both original session permissions and present persisted grants.
    const activeUser = await tx.user.findFirst({
      where: { id: session.user.id, organizationId, status: "ACTIVE" },
      select: { roles: { include: {
        role: { include: { permissions: { include: { permission: true } } } },
      } } },
    });
    const livePermissions = new Set(activeUser?.roles.filter(item =>
      item.role.status === "ACTIVE" && item.role.organizationId === organizationId
    ).flatMap(item => item.role.permissions.map(grant => grant.permission.code)) || []);
    const has = (code: string) => sessionPermissions.has(code) && livePermissions.has(code);
    if (!has("catalog.manage"))
      return { error: "reconciliation_permission_revoked", httpStatus: 403 } as const;
    const classes = await tx.catalogImportRow.groupBy({
      by: ["entityType"], where: { batchId: batch.id }, _count: { _all: true },
    });
    if (classes.some(item => !catalogExportTypes.has(item.entityType as CatalogExportType)))
      return { error: "reconciliation_invalid_entity", httpStatus: 409 } as const;
    if (classes.some(item => item.entityType === "REFERENCE_INTERVAL") &&
        !has("catalog.reference_ranges.manage"))
      return { error: "reconciliation_clinical_permission_revoked", httpStatus: 403 } as const;
    if (classes.some(item => item.entityType.startsWith("PRICE_")) && !has("pricing.manage"))
      return { error: "reconciliation_pricing_permission_revoked", httpStatus: 403 } as const;

    const liveBranch = await tx.branch.findFirst({
      where: { id: session.activeBranchId || "", organizationId, status: "ACTIVE" },
      select: { id: true, organizationId: true, status: true },
    });
    const branchGrants = await tx.userBranchScope.findMany({
      where: { userId: session.user.id, branch: { organizationId, status: "ACTIVE" } },
      select: { branchId: true },
    });
    const initiallyGrantedBranches = new Set(session.user.branchScopes.filter(item =>
      item.branch.organizationId === organizationId && item.branch.status === "ACTIVE"
    ).map(item => item.branchId));
    const branchIds = branchGrants.map(item => item.branchId)
      .filter(id => initiallyGrantedBranches.has(id));
    const departmentGrants = await tx.userDepartmentScope.findMany({
      where: { userId: session.user.id },
      select: { departmentId: true, department: {
        select: { organizationId: true, branchId: true, status: true },
      } },
    });
    const initiallyGrantedDepartments = new Set(session.user.departmentScopes.map(item => item.departmentId));
    const restrictedDepartments = session.user.departmentScopes.length > 0;
    const currentDepartments = restrictedDepartments
      ? departmentGrants.filter(item => initiallyGrantedDepartments.has(item.departmentId))
      : departmentGrants;
    if (restrictedDepartments && !currentDepartments.length)
      return { error: "reconciliation_department_revoked", httpStatus: 403 } as const;
    const liveScope = resolveClinicalImportScope({
      organizationId, activeBranchId: session.activeBranchId, activeBranch: liveBranch,
      branchScopes: branchIds.map(branchId => ({ branchId, branch: { status: "ACTIVE" } })),
      departmentScopes: currentDepartments,
    });
    if (!liveScope)
      return { error: "reconciliation_clinical_scope_revoked", httpStatus: 403 } as const;

    // Authorize *all* 5k staged identities, not only the currently displayed page.
    const staged = await tx.catalogImportRow.findMany({
      where: { batchId: batch.id }, orderBy: { rowNumber: "asc" },
      select: { rowNumber: true, entityType: true, sourceData: true,
        normalizedData: true, status: true, importedEntityId: true },
    });
    if (!staged.length || staged.length > BUNDLE_REVIEW_MAX_ROWS ||
        staged.some(row => row.status !== "WARNING" || row.importedEntityId !== null))
      return { error: "reconciliation_batch_changed", httpStatus: 409 } as const;

    const idsByType = new Map<CatalogExportType, string[]>();
    const testRefs = new Set<string>(), unitRefs = new Set<string>();
    const componentRefs = new Set<string>(), priceListRefs = new Set<string>();
    const activeBranchIds = new Set(branchIds);
    for (const row of staged) {
      const n = record(row.normalizedData), source = record(row.sourceData);
      const type = row.entityType as CatalogExportType;
      const id = n?.id;
      if (!n || !source || typeof id !== "string" || !UUID.test(id) ||
          source.id !== id || !catalogExportTypes.has(type))
        return { error: "reconciliation_source_identity_invalid", httpStatus: 409 } as const;
      const values = idsByType.get(type) || [];
      if (values.includes(id))
        return { error: "reconciliation_duplicate_identity", httpStatus: 409 } as const;
      values.push(id);
      idsByType.set(type, values);
      for (const [field, set] of [
        ["testId", testRefs], ["unitId", unitRefs],
        ["componentId", componentRefs], ["priceListId", priceListRefs],
      ] as const) {
        const value = n[field];
        if (value === null || value === undefined) continue;
        if (typeof value !== "string" || !UUID.test(value))
          return { error: "reconciliation_parent_identity_invalid", httpStatus: 409 } as const;
        set.add(value);
      }
      if (n.branchId !== null && n.branchId !== undefined &&
          (typeof n.branchId !== "string" || !activeBranchIds.has(n.branchId)))
        return { error: "reconciliation_branch_scope_revoked", httpStatus: 403 } as const;
      if ((n.scopeType === "BRANCH" && !n.branchId) ||
          (n.scopeType === "ORGANIZATION" && n.branchId))
        return { error: "reconciliation_price_scope_invalid", httpStatus: 403 } as const;
    }
    const testScope = { ...clinicalImportTestWhere(liveScope), status: undefined };
    const branchScope = { OR: [{ branchId: null }, { branchId: { in: branchIds } }] };
    const genericPriceScope = { OR: [
      { scopeType: "ORGANIZATION" as const, branchId: null },
      { scopeType: "BRANCH" as const, branchId: { in: branchIds } },
    ] };
    const [mappedTests, mappedUnits, mappedComponents, mappedLists] = await Promise.all([
      tx.labTest.count({ where: { ...testScope, id: { in: [...testRefs] } } }),
      tx.unit.count({ where: { organizationId, id: { in: [...unitRefs] } } }),
      tx.testComponent.count({ where: { id: { in: [...componentRefs] }, test: testScope } }),
      tx.priceList.count({ where: { organizationId, ...genericPriceScope, id: { in: [...priceListRefs] } } }),
    ]);
    if (mappedTests !== testRefs.size || mappedUnits !== unitRefs.size ||
        mappedComponents !== componentRefs.size || mappedLists !== priceListRefs.size)
      return { error: "reconciliation_parent_scope_changed", httpStatus: 403 } as const;

    // Exact same six native export selects; comparison uses serialized JSON.
    const live = new Map<string, unknown>();
    for (const type of ordered) {
      const ids = idsByType.get(type) || [];
      if (!ids.length) continue;
      const base = { orderBy: { id: "asc" as const }, take: ids.length };
      const cursorScope = { id: { in: ids } };
      let records: Array<{ id: string }> = [];
  if (type === "TEST") {
    records = await tx.labTest.findMany({
      ...base, where: { ...testScope, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true, abbreviation: true,
        departmentId: true, specimenTypeId: true, containerId: true,
        methodId: true, defaultUnitId: true, resultType: true,
        workflowType: true, resultEntryLayout: true, decimalPrecision: true,
        minimumVolume: true, minimumVolumeUnit: true, assay: true,
        tatMinutes: true, loincCode: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
      },
    });
  } else if (type === "COMPONENT") {
    records = await tx.testComponent.findMany({
      ...base, where: { test: testScope, ...cursorScope },
      select: {
        id: true, testId: true, code: true, nameEn: true, nameAr: true,
        unitId: true, resultType: true, decimalPrecision: true,
        displayOrder: true, resultSectionId: true,
        reportNameEn: true, reportNameAr: true, reportDisplayOrder: true,
        reportVisible: true, entryWidth: true, entryHintEn: true, entryHintAr: true,
        status: true, createdAt: true, updatedAt: true, deactivatedAt: true,
        test: { select: { code: true } },
        unit: { select: { code: true, symbol: true } },
      },
    });
  } else if (type === "UNIT") {
    records = await tx.unit.findMany({
      ...base, where: { organizationId, ...cursorScope },
      select: {
        id: true, code: true, symbol: true, nameEn: true, nameAr: true,
        ucumCode: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
      },
    });
  } else if (type === "REFERENCE_INTERVAL") {
    records = await tx.referenceInterval.findMany({
      ...base, where: { component: { test: testScope }, ...branchScope, ...cursorScope },
      select: {
        id: true, componentId: true, branchId: true, methodId: true,
        analyzerId: true, specimenTypeId: true, sex: true, ageFrom: true,
        ageTo: true, ageUnit: true, pregnancyStatus: true,
        gestationalAgeFromWeeks: true, gestationalAgeToWeeks: true,
        populationCode: true, lowValue: true, highValue: true,
        normalTextEn: true, normalTextAr: true, criticalLow: true,
        criticalHigh: true, source: true, notes: true,
        effectiveFrom: true, effectiveTo: true, approvalStatus: true,
        status: true, approvedAt: true, retiredAt: true,
        createdAt: true, updatedAt: true,
        component: { select: { code: true, test: { select: { code: true } } } },
      },
    });
  } else if (type === "PRICE_LIST") {
    records = await tx.priceList.findMany({
      ...base, where: { organizationId, ...genericPriceScope, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true, scopeType: true,
        branchId: true, sourceId: true, referrerId: true, clientId: true,
        contractId: true, currency: true, priority: true, effectiveFrom: true,
        effectiveTo: true, status: true, createdAt: true, updatedAt: true,
        deactivatedAt: true,
      },
    });
  } else if (type === "PRICE_LIST_ITEM") {
    records = await tx.priceListItem.findMany({
      ...base,
      where: { priceList: { organizationId, ...genericPriceScope }, test: testScope, ...cursorScope },
      select: {
        id: true, priceListId: true, testId: true, unitPrice: true,
        effectiveFrom: true, effectiveTo: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
        test: { select: { code: true } },
        priceList: { select: { code: true, currency: true, scopeType: true, branchId: true } },
      },
    });
  }



      if (records.length !== ids.length)
        return { error: "reconciliation_live_master_scope_changed", httpStatus: 403 } as const;
      for (const current of records) live.set(type + ":" + current.id, current);
    }
    const page = staged.filter(row => row.rowNumber > after).slice(0, PAGE_SIZE + 1);
    const shown = page.slice(0, PAGE_SIZE);
    const rows = shown.map(row => {
      const id = String(record(row.normalizedData)?.id || "");
      const value = live.get(row.entityType + ":" + id);
      return {
        rowNumber: row.rowNumber, entityType: row.entityType,
        ...catalogBundleDrift(row.sourceData, JSON.parse(JSON.stringify(value))),
      };
    });
    const verified = record(batch.summary)?.attestationStatus === "VERIFIED";
    await tx.auditEvent.create({ data: {
      organizationId, branchId: liveScope.branchId, actorUserId: session.user.id,
      action: "CATALOG_BUNDLE_DRIFT_REVIEWED", entityType: "CatalogImportBatch",
      entityId: batch.id, newValues: {
        displayed: rows.length, after, changed: rows.filter(r => r.disposition === "DRIFTED").length,
        sourceVerified: verified, readOnly: true,
      }, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    } });
    return { rows, hasMore: page.length > PAGE_SIZE,
      nextCursor: page.length > PAGE_SIZE ? shown[shown.length - 1].rowNumber : null,
      sourceVerified: verified, liveWrites: false, clinicalActivation: false,
      priceActivation: false, approvalRequired: true, reviewedAt: new Date().toISOString(),
    } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  if ("error" in outcome)
    return NextResponse.json({ error: outcome.error }, {
      status: outcome.httpStatus, headers: { "Cache-Control": "private, no-store" },
    });
  return NextResponse.json(outcome, { headers: { "Cache-Control": "private, no-store" } });
}
