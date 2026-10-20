import type { Prisma } from "../../generated/prisma/client";
import { clinicalImportTestWhere, type ClinicalImportScope } from "./catalog-clinical-import-scope.ts";
import { catalogExportTypes, type CatalogExportType } from "./catalog-configuration-export.ts";

/**
 * Single canonical full-value wire projection used by BOTH author drift and
 * independent live preflight. Changes to any export-select field must affect
 * both observation tokens identically. Scoped reads only; never a mapping
 * approval or a write authorization.
 */
export async function readCatalogLiveObservations(
  tx: Prisma.TransactionClient,
  scope: ClinicalImportScope,
  branchIds: readonly string[],
  idsByType: ReadonlyMap<CatalogExportType, string[]>,
): Promise<Map<string, unknown> | null> {
  const organizationId = scope.organizationId;
  const testScope = { ...clinicalImportTestWhere(scope), status: undefined };
  const branchScope = { OR: [{ branchId: null }, { branchId: { in: [...branchIds] } }] };
  const genericPriceScope = { OR: [
    { scopeType: "ORGANIZATION" as const, branchId: null },
    { scopeType: "BRANCH" as const, branchId: { in: [...branchIds] } },
  ] };
  const fullyVisibleItems = { some: {}, every: { test: testScope } };
  const live = new Map<string, unknown>();
  for (const type of catalogExportTypes) {
    const ids = idsByType.get(type) || [];
    if (!ids.length) continue;
    if (new Set(ids).size !== ids.length) return null;
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
  } else if (type === "PANEL") {
    records = await tx.testPanel.findMany({
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
    records = await tx.commercialPackage.findMany({
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
    records = await tx.unit.findMany({
      ...base, where: { organizationId, ...cursorScope },
      select: {
        id: true, code: true, symbol: true, nameEn: true, nameAr: true,
        ucumCode: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
      },
    });
  } else if (type === "CONTAINER") {
    records = await tx.container.findMany({
      ...base, where: { organizationId, ...cursorScope },
      select: {
        id: true, code: true, nameEn: true, nameAr: true,
        tubeColor: true, additive: true, status: true,
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
  } else if (type === "PRICE_LIST_PACKAGE_ITEM") {
    records = await tx.priceListPackageItem.findMany({
      ...base, where: {
        ...cursorScope,
        package: { organizationId, items: fullyVisibleItems },
        priceList: { organizationId, ...genericPriceScope,
          sourceId: null, referrerId: null, clientId: null, contractId: null },
      },
      select: {
        id: true, priceListId: true, packageId: true, unitPrice: true,
        effectiveFrom: true, effectiveTo: true, status: true,
        createdAt: true, updatedAt: true, deactivatedAt: true,
        package: { select: { code: true } },
        priceList: { select: {
          code: true, currency: true, scopeType: true, branchId: true,
          status: true, sourceId: true, referrerId: true, clientId: true, contractId: true,
        } },
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
        priceList: { select: {
          code: true, currency: true, scopeType: true, branchId: true,
          status: true, sourceId: true, referrerId: true, clientId: true, contractId: true,
        } },
      },
    });
  }



      if (records.length !== ids.length)
        return { error: "reconciliation_live_master_scope_changed", httpStatus: 403 } as const;
      for (const current of records) live.set(type + ":" + current.id, current);
    }
    if (records.length !== ids.length) return null;
    for (const current of records)
      live.set(type + ":" + current.id, JSON.parse(JSON.stringify(current)));
  }
  return live;
}
