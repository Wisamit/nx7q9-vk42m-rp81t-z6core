import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { liveCatalogReviewStagingAuthority } from "@/lib/catalog-review-staging-auth";
import { clinicalImportTestWhere } from "@/lib/catalog-clinical-import-scope";
import { genericCatalogPriceScope } from "@/lib/catalog-generic-price-scope";
import {
  F2_EFFECTIVE_READ_TYPES,resolveF2EffectiveCatalogViews,
  projectF2EffectiveCatalogView,
} from "@/lib/catalog-f2-effective-view";
import {
  catalogExportNavigation, catalogExportTypes, type CatalogExportType,
} from "@/lib/catalog-configuration-export";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const permissions = permissionSet(session);
  if (!permissions.has("catalog.manage")) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const parameters = request.nextUrl.searchParams;
  const type = parameters.get("entityType");
  if (!type || !catalogExportTypes.has(type as CatalogExportType)) {
    return NextResponse.json({ error: "unsupported_catalog_export_entity" }, { status: 400 });
  }
  if (type === "REFERENCE_INTERVAL" && !permissions.has("catalog.reference_ranges.manage")) {
    return NextResponse.json({ error: "reference_ranges_manage_required" }, { status: 403 });
  }
  if ((type === "PRICE_LIST" || (type === "PRICE_LIST_ITEM" || type === "PRICE_LIST_PACKAGE_ITEM")) && !permissions.has("pricing.manage")) {
    return NextResponse.json({ error: "pricing_export_forbidden" }, { status: 403 });
  }
  const parsed = catalogExportNavigation(parameters.get("cursor"));
  if (!parsed.ok) return NextResponse.json({ error: "invalid_export_cursor" }, { status: 400 });

  // Consistent point-in-time authorization precedes ALL ten export types.
  // The tenant lock prevents queued exports from using stale grants.
  return prisma.$transaction(async tx => {
  const prisma = tx;
  const organizationId = session.user.organizationId;
  const lock = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM organizations WHERE id = ${organizationId}
      AND status = 'ACTIVE' FOR UPDATE
  `;
  if (lock.length !== 1)
    return NextResponse.json({ error: "export_organization_inactive" }, { status: 403 });
  const authorized = await liveCatalogReviewStagingAuthority(tx, {
    userId: session.user.id, organizationId,
    activeBranchId: session.activeBranchId || "",
    sessionBranchIds: session.user.branchScopes.filter(item =>
      item.branch.status === "ACTIVE" && item.branch.organizationId === organizationId
    ).map(item => item.branchId),
    sessionDepartmentIds: session.user.departmentScopes.map(item => item.departmentId),
    needsPricing: type.startsWith("PRICE_"),
    needsRanges: type === "REFERENCE_INTERVAL",
    needsClinicalScope: true,
  });
  if (!authorized)
    return NextResponse.json({ error: "export_live_scope_or_permission_revoked" }, { status: 403 });
  const branchIds = authorized.branchIds;
  const departmentIds = authorized.departmentIds;
  // All tests, including a paged TEST/COMPONENT/PRICE_LIST_ITEM export, must
  // obey the active branch and its clinical departments (not just panels).
  const testScope = { ...clinicalImportTestWhere({
    organizationId, branchId: session.activeBranchId!, departmentIds,
  }), status: undefined };
  const isComposite = type === "PANEL" || type === "PACKAGE" ||
    type === "PRICE_LIST_PACKAGE_ITEM";
  const clinicalScope = isComposite ? {
    organizationId, branchId: session.activeBranchId!, departmentIds,
  } : null;
  if (isComposite && !clinicalScope)
    return NextResponse.json({ error: "active_clinical_export_scope_required" }, { status: 403 });
  const compositeTestScope = clinicalScope
    ? { ...clinicalImportTestWhere(clinicalScope), status: undefined }
    : testScope;
  // Composite records are exported only if *every* member is accessible,
  // avoiding partial panels/packages that silently lose clinical tests.
  const fullyVisibleItems = {
    some: { test: compositeTestScope },
    every: { test: compositeTestScope },
  };
  const branchScope = { OR: [{ branchId: null }, { branchId: { in: branchIds } }] };
  // Generic exports cannot disclose client/contract/source/referrer prices.
  const genericPriceScope = genericCatalogPriceScope(branchIds);
  // Lexical id keyset paging does not depend on a cursor record still existing
  // and never uses a foreign-tenant row as a Prisma cursor anchor.
  const base = { orderBy: { id: "asc" as const }, take: 251 };
  const cursorScope = parsed.cursor ? { id: { gt: parsed.cursor } } : {};
  let records: Array<{ id: string }> = [];

  if (type === "TEST") {
    records = await prisma.labTest.findMany({
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
    records = await prisma.testComponent.findMany({
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
  } else if (type === "PANEL") {
    records = await prisma.testPanel.findMany({
      ...base, where: { organizationId, items: fullyVisibleItems, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true,
        descriptionEn: true, descriptionAr: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
        items: { select: {
          testId: true, displayOrder: true, required: true,
          test: { select: { code: true } },
        }, orderBy: [{ displayOrder: "asc" }, { testId: "asc" }] },
      },
    });
  } else if (type === "PACKAGE") {
    records = await prisma.commercialPackage.findMany({
      ...base, where: { organizationId, items: fullyVisibleItems, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true,
        descriptionEn: true, descriptionAr: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
        items: { select: {
          testId: true, displayOrder: true,
          test: { select: { code: true } },
        }, orderBy: [{ displayOrder: "asc" }, { testId: "asc" }] },
      },
    });
  } else if (type === "UNIT") {
    records = await prisma.unit.findMany({
      ...base, where: { organizationId, ...cursorScope },
      select: {
        id: true, code: true, symbol: true, nameEn: true, nameAr: true,
        ucumCode: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
      },
    });
  } else if (type === "CONTAINER") {
    records = await prisma.container.findMany({
      ...base, where: { organizationId, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true,
        tubeColor: true, additive: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
      },
    });
  } else if (type === "REFERENCE_INTERVAL") {
    records = await prisma.referenceInterval.findMany({
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
    records = await prisma.priceList.findMany({
      ...base, where: { organizationId, ...genericPriceScope, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true, scopeType: true,
        branchId: true, sourceId: true, referrerId: true, clientId: true,
        contractId: true, currency: true, priority: true, effectiveFrom: true,
        effectiveTo: true, status: true, createdAt: true, updatedAt: true,
        deactivatedAt: true,
      },
    });
  } else if (type === "PRICE_LIST_PACKAGE_ITEM") {
    records = await prisma.priceListPackageItem.findMany({
      ...base, where: {
        ...cursorScope,
        package: { organizationId, items: fullyVisibleItems },
        priceList: {
          organizationId, ...genericPriceScope,
          sourceId: null, clientId: null, contractId: null, referrerId: null,
        },
      },
      select: {
        id: true, priceListId: true, packageId: true,
        unitPrice: true, effectiveFrom: true, effectiveTo: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
        package: { select: { code: true } },
        priceList: { select: {
          code: true, currency: true, scopeType: true, branchId: true,
          status: true, sourceId: true, referrerId: true, clientId: true, contractId: true,
        } },
      },
    });
  } else if (type === "PRICE_LIST_ITEM") {
    records = await prisma.priceListItem.findMany({
      ...base,
      where: { priceList: { organizationId, ...genericPriceScope }, test: testScope, ...cursorScope },
      select: {
        id: true, priceListId: true, testId: true, unitPrice: true,
        effectiveFrom: true, effectiveTo: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
        test: { select: { code: true } },
        priceList: { select: { code: true, currency: true, scopeType: true, branchId: true,
          status: true, sourceId: true, referrerId: true, clientId: true, contractId: true } },
      },
    });
  }

  const hasMore = records.length > 250;
  const shown = records.slice(0, 250);
  const nextCursor = hasMore ? shown[shown.length - 1].id : null;
  let effectiveShown=shown;
  if(shown.length && F2_EFFECTIVE_READ_TYPES.some(t=>t===type)){
    const effectiveType=type as typeof F2_EFFECTIVE_READ_TYPES[number];
    // Apply only time-effective signed master revisions to previously scoped
    // base rows. A page cursor and source field contract stay unchanged.
    const overlays=await resolveF2EffectiveCatalogViews(tx,{
      organizationId,asOf:new Date(),
      records:shown.map(row=>({entityType:effectiveType,id:row.id})),
    });
    effectiveShown=shown.map(row=>
      projectF2EffectiveCatalogView(effectiveType,row,overlays));
  }

  // Log config exports; never update catalog definitions or historical prices.
  const ctx = await requestContext();
  await prisma.auditEvent.create({
    data: {
      organizationId, branchId: session.activeBranchId,
      actorUserId: session.user.id, action: "CATALOG_CONFIGURATION_EXPORTED",
      entityType: "CatalogConfiguration", entityId: organizationId,
      newValues: {
        exportType: type, returnedRows: shown.length,
        hasMore, cursorProvided: parsed.cursor !== null,
        branchScoped: true, departmentScoped: departmentIds.length > 0,
      },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },
  });

  // Prisma Decimal.toJSON() produces an exact decimal string, never a JS float.
  return NextResponse.json({
    format: "family-lab-catalog-export",
    schemaVersion: 1,
    entityType: type,
    organizationId,
    generatedAt: new Date().toISOString(),
    consistency: "paged-live-not-atomic",
    pageSize: 250,
    records: effectiveShown,
    nextCursor,
    hasMore,
  }, { headers: { "Cache-Control": "private, no-store" } });
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
