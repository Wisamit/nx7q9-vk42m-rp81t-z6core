import { createHash } from "node:crypto";
import { sealReviewStageEvidence } from "@/lib/catalog-review-stage-evidence";
import { NextResponse } from "next/server";
import { Prisma } from "../../../../../../generated/prisma/client";
import { sameCompositeMembership, type CompositeMember } from "@/lib/catalog-composite-bundle";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { catalogStageSubmissionKey, lookupCatalogStageReplay } from "@/lib/catalog-stage-idempotency";
import {
  CatalogBundleAttestationError, catalogBundleSigningSecret, verifyCatalogBundleAttestation,
} from "@/lib/catalog-bundle-attestation";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { genericCatalogPriceScope } from "@/lib/catalog-generic-price-scope";
import { BundleFieldContractError, verifyBundleFieldContract, type BundleFieldContractStatus } from "@/lib/catalog-bundle-field-contract";
import {
  BUNDLE_REVIEW_MAX_BYTES, BUNDLE_REVIEW_SOURCE,
  CatalogBundleReviewError, parseCatalogBundleForReview,
} from "@/lib/catalog-bundle-review";

export async function POST(request: Request) {
  const session = await requirePermission("catalog.manage");
  const requestKey = catalogStageSubmissionKey(request.headers.get("x-family-lab-staging-key"));
  if (!requestKey.valid) return NextResponse.json({ error: "invalid_catalog_staging_key" }, { status: 400 });
  const perms = permissionSet(session);
  const scope = resolveClinicalImportScope({
    organizationId: session.user.organizationId,
    activeBranchId: session.activeBranchId, activeBranch: session.activeBranch,
    branchScopes: session.user.branchScopes, departmentScopes: session.user.departmentScopes,
  });
  if (!scope) return NextResponse.json({ error: "active_clinical_import_scope_required" }, { status: 403 });
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
    return NextResponse.json({ error: "bundle_json_content_type_required" }, { status: 415 });
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(length) || length < 0 || length > BUNDLE_REVIEW_MAX_BYTES) {
    return NextResponse.json({ error: "bundle_too_large" }, { status: 413 });
  }
  const sourceName = new URL(request.url).searchParams.get("sourceName")?.trim() || "";
  if (!sourceName.toLowerCase().endsWith(".json") || sourceName.length > 255 ||
      [...sourceName].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127)) {
    return NextResponse.json({ error: "bundle_invalid_source_name" }, { status: 400 });
  }
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "bundle_missing_content" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > BUNDLE_REVIEW_MAX_BYTES) {
      await reader.cancel("bundle_too_large");
      return NextResponse.json({ error: "bundle_too_large" }, { status: 413 });
    }
    chunks.push(next.value);
  }
  let payload: unknown;
  try {
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "bundle_invalid_json_or_utf8" }, { status: 400 });
  }
  let parsed: ReturnType<typeof parseCatalogBundleForReview>;
  let attestationStatus: "VERIFIED" | "UNVERIFIED";
  let fieldContractStatus: BundleFieldContractStatus;
  try {
    parsed = parseCatalogBundleForReview(payload, scope.organizationId, {
      pricing: perms.has("pricing.manage"), ranges: perms.has("catalog.reference_ranges.manage"),
    });
    attestationStatus = verifyCatalogBundleAttestation(payload, catalogBundleSigningSecret(process.env));
    fieldContractStatus = verifyBundleFieldContract(payload);
  } catch (error) {
    if (error instanceof BundleFieldContractError) {
      return NextResponse.json({ error: error.code }, { status: 409 });
    }
    if (error instanceof CatalogBundleReviewError || error instanceof CatalogBundleAttestationError) {
      return NextResponse.json({ error: error.code }, { status: error.status });
    }
    throw error;
  }

  const references = parsed.rows;
  const ctx = await requestContext();
  const checksum = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
  const outcome = await prisma.$transaction(async tx => {
    // Same tenant lock as manual unit creation and legacy import commits.
    const organizationLock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations WHERE id = ${scope.organizationId}
        AND status = 'ACTIVE' FOR UPDATE
    `;
    if (organizationLock.length !== 1) {
      return { error: "bundle_organization_inactive", httpStatus: 403 } as const;
    }
  const liveUser = await tx.user.findFirst({
    where: { id: session.user.id, organizationId: scope.organizationId, status: "ACTIVE" },
    include: { roles: { include: { role: { include: {
      permissions: { include: { permission: true } },
    } } } } },
  });
  const livePermissions = new Set((liveUser?.roles || [])
    .filter(r => r.role.status === "ACTIVE" && r.role.organizationId === scope.organizationId)
    .flatMap(r => r.role.permissions.map(grant => grant.permission.code)));
  if (!livePermissions.has("catalog.manage") ||
      (references.some(r => r.entityType.startsWith("PRICE_")) &&
        !livePermissions.has("pricing.manage")) ||
      (references.some(r => r.entityType === "REFERENCE_INTERVAL") &&
        !livePermissions.has("catalog.reference_ranges.manage"))) {
    return { error: "bundle_import_permission_changed", httpStatus: 403 } as const;
  }
  // Session scopes can be stale. Revalidate actual grants after the
  // organization lock, before reading master identities or writing review data.
  const liveBranch = await tx.branch.findFirst({
    where: { id: scope.branchId, organizationId: scope.organizationId, status: "ACTIVE" },
    select: { id: true, organizationId: true, status: true },
  });
  const liveBranchGrants = await tx.userBranchScope.findMany({
    where: { userId: session.user.id, branch: { organizationId: scope.organizationId, status: "ACTIVE" } },
    select: { branchId: true },
  });
  const initiallyGrantedBranches = new Set(session.user.branchScopes.filter(
    grant => grant.branch.status === "ACTIVE" && grant.branch.organizationId === scope.organizationId
  ).map(grant => grant.branchId));
  const currentBranchIds = liveBranchGrants.map(grant => grant.branchId)
    .filter(id => initiallyGrantedBranches.has(id));
  const liveDepartmentGrants = await tx.userDepartmentScope.findMany({
    where: { userId: session.user.id },
    select: { departmentId: true, department: {
      select: { status: true, organizationId: true, branchId: true },
    } },
  });
  const initiallyGrantedDepartments = new Set(session.user.departmentScopes.map(grant => grant.departmentId));
  const currentDepartmentGrants = session.user.departmentScopes.length
    ? liveDepartmentGrants.filter(grant => initiallyGrantedDepartments.has(grant.departmentId))
    : liveDepartmentGrants;
  // A revoked last department grant cannot turn restricted scope into global access.
  if (session.user.departmentScopes.length && !currentDepartmentGrants.length) {
    return { error: "bundle_department_scope_changed", httpStatus: 403 } as const;
  }
  const liveScope = resolveClinicalImportScope({
    organizationId: scope.organizationId, activeBranchId: scope.branchId,
    activeBranch: liveBranch,
    branchScopes: currentBranchIds.map(branchId => ({ branchId, branch: { status: "ACTIVE" } })),
    departmentScopes: currentDepartmentGrants,
  });
  if (!liveScope) return { error: "bundle_clinical_scope_changed", httpStatus: 403 } as const;
  const activeBranches = new Set(currentBranchIds);
  for (const row of references) {
    const branchId = row.normalized.branchId;
    if (branchId && (typeof branchId !== "string" || !activeBranches.has(branchId))) {
      return { error: "bundle_branch_scope_denied", httpStatus: 403 } as const;
    }
    if (row.normalized.scopeType === "BRANCH" && !branchId ||
        row.normalized.scopeType === "ORGANIZATION" && branchId) {
      return { error: "bundle_price_scope_mismatch", httpStatus: 403 } as const;
    }
  }

  // All input UUIDs must identify *currently permitted* masters. This is a
  // read-only review of an actual export, NOT a foreign-database restore path.
  // In particular never disclose existing CLIENT/CONTRACT prices through this
  // generic catalog import surface.
  const testWhere = { ...clinicalImportTestWhere(liveScope), status: undefined };
  const testIds = [...new Set([
    ...parsed.ids.tests,
    ...parsed.ids.memberTests,
    ...references.filter(x => x.entityType === "COMPONENT" || x.entityType === "PRICE_LIST_ITEM")
      .map(x => x.original.testId as string),
  ])];
  const unitIds = [...new Set([
    ...parsed.ids.units,
    ...references.filter(x => x.entityType === "COMPONENT" && x.original.unitId)
      .map(x => x.original.unitId as string),
  ])];
  const componentIds = [...new Set([
    ...parsed.ids.components,
    ...references.filter(x => x.entityType === "REFERENCE_INTERVAL")
      .map(x => x.original.componentId as string),
  ])];
  const priceListIds = [...new Set([
    ...parsed.ids.priceLists,
    ...parsed.ids.compositePriceLists,
    ...references.filter(x => x.entityType === "PRICE_LIST_ITEM")
      .map(x => x.original.priceListId as string),
  ])];
  const panelIds = [...new Set(parsed.ids.panels)];
  const packageIds = [...new Set([...parsed.ids.packages, ...parsed.ids.pricedPackages])];
  const packagePriceIds = [...new Set(parsed.ids.packagePrices)];
  // Import review must use the identical private-tariff boundary as export.
  // Neither a signed nor an unsigned source bundle can widen this policy.
  const permittedPriceList = {
    organizationId: scope.organizationId,
    ...genericCatalogPriceScope([...activeBranches]),
  };
  const [tests, units, containers, components, intervals, lists, prices] = await Promise.all([
    tx.labTest.findMany({ where: { ...testWhere, id: { in: testIds } },
      select: { id: true, code: true, departmentId: true } }),
    tx.unit.findMany({ where: { organizationId: scope.organizationId, id: { in: unitIds } },
      select: { id: true, code: true } }),
    tx.container.findMany({ where: { organizationId: scope.organizationId,
      id: { in: parsed.ids.containers } },
      select: { id: true, code: true, nameEn: true, nameAr: true,
        tubeColor: true, additive: true, status: true } }),
    tx.testComponent.findMany({ where: { id: { in: componentIds }, test: testWhere },
      select: { id: true, code: true, testId: true, unitId: true } }),
    tx.referenceInterval.findMany({ where: {
      id: { in: parsed.ids.intervals },
      component: { test: testWhere },
      OR: [{ branchId: null }, { branchId: { in: [...activeBranches] } }],
    }, select: { id: true, componentId: true, branchId: true } }),
    tx.priceList.findMany({ where: { ...permittedPriceList, id: { in: priceListIds } },
      select: { id: true, code: true, currency: true, scopeType: true, branchId: true } }),
    tx.priceListItem.findMany({ where: {
      id: { in: parsed.ids.prices }, priceList: permittedPriceList, test: testWhere,
    }, select: { id: true, priceListId: true, testId: true } }),
  ]);
  const [panels, packages, packagePrices] = await Promise.all([
    tx.testPanel.findMany({ where: {
      id: { in: panelIds }, organizationId: scope.organizationId,
      items: { some: { test: testWhere }, every: { test: testWhere } },
    }, select: {
      id: true, code: true, status: true,
      items: { select: {
        testId: true, displayOrder: true, required: true, test: { select: { code: true } },
      } },
    } }),
    tx.commercialPackage.findMany({ where: {
      id: { in: packageIds }, organizationId: scope.organizationId,
      items: { some: { test: testWhere }, every: { test: testWhere } },
    }, select: {
      id: true, code: true, status: true,
      items: { select: { testId: true, displayOrder: true, test: { select: { code: true } } } },
    } }),
    tx.priceListPackageItem.findMany({ where: {
      id: { in: packagePriceIds },
      priceList: permittedPriceList,
      package: { organizationId: scope.organizationId,
        items: { some: { test: testWhere }, every: { test: testWhere } } },
    }, select: {
      id: true, priceListId: true, packageId: true, unitPrice: true,
      effectiveFrom: true, effectiveTo: true, status: true,
    } }),
  ]);
  if (tests.length !== testIds.length || units.length !== unitIds.length ||
      containers.length !== parsed.ids.containers.length ||
      components.length !== componentIds.length || intervals.length !== parsed.ids.intervals.length ||
      lists.length !== priceListIds.length || prices.length !== parsed.ids.prices.length ||
      panels.length !== panelIds.length || packages.length !== packageIds.length ||
      packagePrices.length !== packagePriceIds.length) {
    return { error: "bundle_master_identity_or_scope_changed", httpStatus: 403 } as const;
  }
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map(x => [x.id, x]));
  const testMap = byId(tests), unitMap = byId(units), containerMap = byId(containers), componentMap = byId(components);
  const intervalMap = byId(intervals), listMap = byId(lists), priceMap = byId(prices);
  const panelMap = byId(panels), packageMap = byId(packages), packagePriceMap = byId(packagePrices);
  for (const row of references) {
    const n = row.normalized, original = row.original;
    let consistent = true;
    if (row.entityType === "TEST") {
      const existing = testMap.get(row.identity);
      consistent = !!existing && existing.code === n.code && existing.departmentId === n.departmentId;
    } else if (row.entityType === "UNIT") {
      consistent = unitMap.get(row.identity)?.code === n.code;
    } else if (row.entityType === "CONTAINER") {
      const existing = containerMap.get(row.identity);
      consistent = !!existing && existing.code === n.code && existing.nameEn === n.nameEn &&
        existing.nameAr === n.nameAr && existing.tubeColor === n.tubeColor &&
        existing.additive === n.additive && existing.status === n.status;
    } else if (row.entityType === "COMPONENT") {
      const existing = componentMap.get(row.identity);
      consistent = !!existing && existing.testId === n.testId && existing.code === n.code &&
        existing.unitId === n.unitId && testMap.get(existing.testId)?.code === n.testCode;
    } else if (row.entityType === "PANEL") {
      const live = panelMap.get(row.identity);
      const members = (live?.items || []).map(item => ({
        testId: item.testId, testCode: item.test.code,
        displayOrder: item.displayOrder, required: item.required,
      }));
      consistent = !!live && live.code === n.code && live.status === n.status &&
        Array.isArray(n.items) && sameCompositeMembership(
          n.items as CompositeMember[], members, "PANEL");
    } else if (row.entityType === "PACKAGE") {
      const live = packageMap.get(row.identity);
      const members = (live?.items || []).map(item => ({
        testId: item.testId, testCode: item.test.code,
        displayOrder: item.displayOrder,
      }));
      consistent = !!live && live.code === n.code && live.status === n.status &&
        Array.isArray(n.items) && sameCompositeMembership(
          n.items as CompositeMember[], members, "PACKAGE");
    } else if (row.entityType === "PRICE_LIST_PACKAGE_ITEM") {
      const price = packagePriceMap.get(row.identity);
      const list = listMap.get(n.priceListId as string);
      const linkedPackage = packageMap.get(n.packageId as string);
      consistent = !!price && !!list && !!linkedPackage &&
        price.priceListId === n.priceListId && price.packageId === n.packageId &&
        list.code === n.priceListCode && linkedPackage.code === n.packageCode &&
        list.scopeType === n.scopeType && list.branchId === n.branchId &&
        list.currency === n.currency && price.status === n.status &&
        price.effectiveFrom.getTime() === new Date(n.effectiveFrom as string).getTime() &&
        (price.effectiveTo?.getTime() ?? null) ===
          (n.effectiveTo ? new Date(n.effectiveTo as string).getTime() : null) &&
        new Prisma.Decimal(n.unitPrice as string).equals(price.unitPrice);
    } else if (row.entityType === "REFERENCE_INTERVAL") {
      const existing = intervalMap.get(row.identity);
      const component = componentMap.get(n.componentId as string);
      consistent = !!existing && !!component && existing.componentId === n.componentId &&
        existing.branchId === n.branchId && component.code === n.componentCode &&
        testMap.get(component.testId)?.code === n.testCode;
    } else if (row.entityType === "PRICE_LIST") {
      const existing = listMap.get(row.identity);
      consistent = !!existing && existing.code === n.code && existing.branchId === n.branchId &&
        existing.scopeType === n.scopeType;
    } else {
      const existing = priceMap.get(row.identity);
      const priceList = listMap.get(n.priceListId as string);
      consistent = !!existing && !!priceList && existing.testId === n.testId &&
        existing.priceListId === n.priceListId && priceList.code === n.priceListCode &&
        priceList.scopeType === n.scopeType && priceList.branchId === n.branchId &&
        testMap.get(existing.testId)?.code === n.testCode &&
        typeof original.unitPrice === "string";
    }
    if (!consistent) return { error: "bundle_master_mapping_mismatch", httpStatus: 409 } as const;
  }

    const replay = await lookupCatalogStageReplay(tx, {
      organizationId: scope.organizationId, authorId: session.user.id,
      sourceType: BUNDLE_REVIEW_SOURCE, sourceName, checksum,
      submissionKey: requestKey.key, expectedStatus: "DRAFT",
    });
    if (replay.kind === "conflict")
      return { error: "catalog_staging_key_reused", httpStatus: 409 } as const;
    if (replay.kind === "replay") return { id: replay.id, replayed: true } as const;
    const initialSummary = { total: references.length, WARNING: references.length,
      reviewOnly: true, format: "family-lab-catalog-bundle",
      consistency: parsed.consistency, attestationStatus, fieldContractStatus,
      exportedAt: parsed.exportedAt, counts: parsed.counts };
    const created = await tx.catalogImportBatch.create({ data: {
      organizationId: scope.organizationId, sourceType: BUNDLE_REVIEW_SOURCE,
      sourceName, sourceChecksum: checksum, submissionKey: requestKey.key,
      status: "DRAFT", validatedAt: null,
      createdByUserId: session.user.id,
      summary: initialSummary,
    }, select: { id: true } });
    await tx.catalogImportRow.createMany({ data: references.map((row, index) => ({
      batchId: created.id, rowNumber: index + 1, entityType: row.entityType,
      legacyKey: row.identity, status: "WARNING",
      sourceData: row.original as Prisma.InputJsonObject,
      normalizedData: row.normalized as Prisma.InputJsonObject,
      validationIssues: [
        { severity: "WARNING", code: "CONFIGURATION_BUNDLE_REVIEW_ONLY",
          message: "Source snapshot only. Approval, mapping and effective-date reconciliation are required; no configuration is applied." },
        ...(fieldContractStatus !== "COMPLETE_SOURCE_FIELD_PROJECTION" ? [{
          severity: "WARNING", code: "SOURCE_FIELD_CONTRACT_NOT_PROVEN",
          message: "This legacy source did not declare a complete signed field projection. Do not infer round-trip parity or approval.",
        }] : []),
        ...(parsed.consistency === "paged-live-not-atomic" ? [{
          severity: "WARNING", code: "PAGED_NON_ATOMIC_EXPORT",
          message: "Source export was paged and not transactionally consistent.",
        }] : []),
        ...(parsed.consistency === "transactional-consistent-read" &&
            attestationStatus !== "VERIFIED" ? [{
          severity: "WARNING", code: "UNVERIFIED_ATOMIC_PROVENANCE",
          message: "The export declares a consistent snapshot, but lacks a verifiable server signature.",
        }] : []),
      ] as Prisma.InputJsonArray,
    })) });
    // Bind the persisted MariaDB JSON rows to a server-keyed HMAC. This
    // detects independent edits to source, normalized or warning evidence.
    // Staging remains review-only if the deployment key is unavailable, but
    // independent reviewers must fail closed on its unsealed summary.
    const signingKey = catalogBundleSigningSecret(process.env);
    const stored = await tx.catalogImportRow.findMany({
      where: { batchId: created.id },
      orderBy: { rowNumber: "asc" },
      select: { id: true, rowNumber: true, entityType: true,
        legacyKey: true, status: true, sourceData: true,
        normalizedData: true, validationIssues: true, importedEntityId: true },
    });
    const stageEvidenceSeal = signingKey ? sealReviewStageEvidence({
      organizationId: scope.organizationId, batchId: created.id,
      authorUserId: session.user.id, sourceChecksum: checksum, rows: stored,
      batchMetadata: { sourceType: BUNDLE_REVIEW_SOURCE, sourceName,
        status: "DRAFT", summary: initialSummary },
    }, signingKey) : null;
    await tx.catalogImportBatch.update({
      where: { id: created.id },
      data: { summary: { ...initialSummary,
        stageEvidenceSeal: stageEvidenceSeal ?? "UNSEALED" } },
    });
    await tx.auditEvent.create({ data: {
      organizationId: scope.organizationId, branchId: scope.branchId,
      actorUserId: session.user.id, action: "CATALOG_CONFIG_BUNDLE_REVIEW_STAGED",
      entityType: "CatalogImportBatch", entityId: created.id,
      newValues: { total: references.length, reviewOnly: true, attestationStatus,
        fieldContractStatus, counts: parsed.counts,
        stageEvidenceSealed: Boolean(stageEvidenceSeal) },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    } });
    return { id: created.id, replayed: false };
  }, { timeout: 30000 });
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus });
  return NextResponse.json({ id: outcome.id, status: "DRAFT", reviewOnly: true,
    replayed: outcome.replayed,
    summary: { total: references.length, WARNING: references.length, counts: parsed.counts, fieldContractStatus } },
  { status: outcome.replayed ? 200 : 201, headers: { "Cache-Control": "private, no-store" } });
}
