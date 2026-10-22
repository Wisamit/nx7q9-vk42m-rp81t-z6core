import { NextRequest, NextResponse } from "next/server";
import { getCurrentSession, permissionSet, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { liveCatalogReviewStagingAuthority } from "@/lib/catalog-review-staging-auth";
import { attestCatalogBundle, catalogBundleSigningSecret } from "@/lib/catalog-bundle-attestation";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { genericCatalogPriceScope } from "@/lib/catalog-generic-price-scope";
import { BUNDLE_REVIEW_MAX_BYTES, BUNDLE_REVIEW_MAX_ROWS } from "@/lib/catalog-bundle-review";
import { catalogExportTypes, type CatalogExportType } from "@/lib/catalog-configuration-export";
import { bundleFieldContract, verifyBundleFieldContract } from "@/lib/catalog-bundle-field-contract";
import {
  F2_EFFECTIVE_READ_TYPES,resolveF2EffectiveCatalogViews,
  projectF2EffectiveCatalogView,f2EffectiveCompositeMemberIds,
  f2EffectiveCompositeMembersAuthorized,
} from "@/lib/catalog-f2-effective-view";

export const dynamic = "force-dynamic";

const ordered: CatalogExportType[] = [
  "TEST", "COMPONENT", "UNIT", "CONTAINER", "PANEL", "PACKAGE",
  "REFERENCE_INTERVAL", "PRICE_LIST", "PRICE_LIST_ITEM", "PRICE_LIST_PACKAGE_ITEM",
];

/**
 * Point-in-time tenant-scoped source export. This is configuration evidence
 * for a separate governed import review, NEVER a database restore or approval.
 */
export async function GET(request: NextRequest) {
  const session = await getCurrentSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const permissions = permissionSet(session);
  if (!permissions.has("catalog.manage")) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const requested = request.nextUrl.searchParams.get("types")?.split(",") ?? [];
  if (!requested.length || requested.length > ordered.length ||
      requested.some(type => !catalogExportTypes.has(type as CatalogExportType)) ||
      new Set(requested).size !== requested.length) {
    return NextResponse.json({ error: "invalid_bundle_export_types" }, { status: 400 });
  }
  if (requested.includes("REFERENCE_INTERVAL") && !permissions.has("catalog.reference_ranges.manage")) {
    return NextResponse.json({ error: "reference_ranges_manage_required" }, { status: 403 });
  }
  if (requested.some(type => type.startsWith("PRICE_")) && !permissions.has("pricing.manage")) {
    return NextResponse.json({ error: "pricing_export_forbidden" }, { status: 403 });
  }
  const scope = resolveClinicalImportScope({
    organizationId: session.user.organizationId,
    activeBranchId: session.activeBranchId, activeBranch: session.activeBranch,
    branchScopes: session.user.branchScopes, departmentScopes: session.user.departmentScopes,
  });
  if (!scope) return NextResponse.json({ error: "active_clinical_export_scope_required" }, { status: 403 });
  const organizationId = scope.organizationId;
  const ctx = await requestContext();
  const signingSecret = catalogBundleSigningSecret(process.env);
  if (!signingSecret) return NextResponse.json({ error: "bundle_signing_key_unavailable" }, { status: 503 });

  const outcome = await prisma.$transaction(async tx => {
    // Prevent same-tenant coordinated changes before live authorization checks.
    const orgLock = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM organizations WHERE id = ${organizationId} AND status = 'ACTIVE' FOR UPDATE`;
    if (orgLock.length !== 1) return { error: "export_organization_inactive", httpStatus: 403 } as const;
    // Same transaction-time role, branch and department authorization as
    // paged exports and CSV/XLSX review staging. Check AFTER the tenant lock
    // so a queued download cannot succeed after permission revocation.
    const authorized = await liveCatalogReviewStagingAuthority(tx, {
      userId: session.user.id, organizationId,
      activeBranchId: scope.branchId,
      sessionBranchIds: session.user.branchScopes.filter(item =>
        item.branch.organizationId === organizationId && item.branch.status === "ACTIVE"
      ).map(item => item.branchId),
      sessionDepartmentIds: session.user.departmentScopes.map(item => item.departmentId),
      needsPricing: requested.some(type => type.startsWith("PRICE_")),
      needsRanges: requested.includes("REFERENCE_INTERVAL"),
      needsClinicalScope: true,
    });
    if (!authorized) return {
      error: "bundle_export_live_scope_or_permission_revoked", httpStatus: 403,
    } as const;
    const branchIds = authorized.branchIds;
    const liveScope = {
      organizationId, branchId: scope.branchId,
      departmentIds: authorized.departmentIds,
    };

    // The same repeatable-read snapshot covers all selected groups. Subordinate
    // masters do not need to participate in the organization locking convention.
    const testScope = { ...clinicalImportTestWhere(liveScope), status: undefined };
    // A partial or mixed-department composite must never be exported.
    const fullyVisibleItems = {
      some: { test: testScope },
      every: { test: testScope },
    };
    const branchScope = { OR: [{ branchId: null }, { branchId: { in: branchIds } }] };
    const genericPriceScope = genericCatalogPriceScope(branchIds);
    const groups: Array<{ entityType: CatalogExportType; records: Array<{ id: string }> }> = [];
    // Pin a single effective clock for all ten exported groups in the same
    // locked transaction. Future/cancelled overlays are invisible.
    const effectiveAt = new Date();
    let total = 0;
    for (const type of ordered.filter(value => requested.includes(value))) {
      const base = { orderBy: { id: "asc" as const }, take: BUNDLE_REVIEW_MAX_ROWS - total + 1 };
      const cursorScope = {};
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
    records = await tx.priceListItem.findMany({
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


      if (records.length + total > BUNDLE_REVIEW_MAX_ROWS) {
        return { error: "bundle_export_too_many_rows", httpStatus: 413 } as const;
      }
      if(F2_EFFECTIVE_READ_TYPES.some(value=>value===type)&&records.length){
        const readType=type as typeof F2_EFFECTIVE_READ_TYPES[number];
        // The base fetch has already enforced tenant, branch, department,
        // and (for PRICE_LIST) finance export scope. Overlay lookup may
        // address ONLY those pre-authorized IDs.
        const revisions=await resolveF2EffectiveCatalogViews(tx,{
          organizationId,asOf:effectiveAt,
          records:records.map(item=>({entityType:readType,id:item.id})),
        });
        records=records.map(item=>
          projectF2EffectiveCatalogView(readType,item,revisions));
        if(type==="PANEL"||type==="PACKAGE"){
          const members=f2EffectiveCompositeMemberIds(type,records);
          if(!members)return {
            error:"bundle_export_effective_membership_invalid",httpStatus:409,
          } as const;
          const scopedTests=await tx.labTest.findMany({
            where:{...testScope,id:{in:[...members.keys()]}},
            select:{id:true,code:true},take:members.size+1,
          });
          if(!f2EffectiveCompositeMembersAuthorized(members,scopedTests))
            return {
              error:"bundle_export_effective_member_scope_changed",
              httpStatus:403,
            } as const;
        }
      }
      total += records.length;
      groups.push({ entityType: type, records });
    }
    if (!total) return { error: "bundle_export_empty", httpStatus: 409 } as const;

    const payload = {
      format: "family-lab-catalog-bundle",
      schemaVersion: 1,
      organizationId,
      exportedAt: new Date().toISOString(),
      consistency: "transactional-consistent-read",
      groups,
      fieldContract: bundleFieldContract(groups.map(group => group.entityType)),
    };
    try {
      verifyBundleFieldContract(payload);
    } catch {
      // Never sign a "complete" export when any selected source field is
      // missing. Fail closed rather than generate misleading audit evidence.
      return { error: "bundle_export_field_projection_incomplete", httpStatus: 409 } as const;
    }
    // Same 4 MiB intake limit as the native JSON review endpoint.
    const serialized = JSON.stringify(attestCatalogBundle(JSON.parse(JSON.stringify(payload)), signingSecret));
    if (Buffer.byteLength(serialized, "utf8") > BUNDLE_REVIEW_MAX_BYTES) {
      return { error: "bundle_export_too_large", httpStatus: 413 } as const;
    }
    await tx.auditEvent.create({ data: {
      organizationId, branchId: scope.branchId, actorUserId: session.user.id,
      action: "CATALOG_CONFIGURATION_ATOMIC_BUNDLE_EXPORTED",
      entityType: "CatalogConfiguration", entityId: organizationId,
      newValues: { types: requested, total, byteLength: Buffer.byteLength(serialized, "utf8"),
        branchScoped: true, departmentScoped: liveScope.departmentIds.length > 0 },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    } });
    return { serialized } as const;
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
  if ("error" in outcome) {
    return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus });
  }
  return new Response(outcome.serialized, { status: 200, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "Content-Disposition": 'attachment; filename="family-lab-catalog-bundle.json"',
  } });
}
