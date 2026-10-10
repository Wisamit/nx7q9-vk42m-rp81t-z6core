import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { Prisma } from "../../../../../../generated/prisma/client";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  CatalogBundleAttestationError, catalogBundleSigningSecret, verifyCatalogBundleAttestation,
} from "@/lib/catalog-bundle-attestation";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import {
  BUNDLE_REVIEW_MAX_BYTES, BUNDLE_REVIEW_SOURCE,
  CatalogBundleReviewError, parseCatalogBundleForReview,
} from "@/lib/catalog-bundle-review";

export async function POST(request: Request) {
  const session = await requirePermission("catalog.manage");
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
  try {
    parsed = parseCatalogBundleForReview(payload, scope.organizationId, {
      pricing: perms.has("pricing.manage"), ranges: perms.has("catalog.reference_ranges.manage"),
    });
    attestationStatus = verifyCatalogBundleAttestation(payload, catalogBundleSigningSecret(process.env));
  } catch (error) {
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
    ...references.filter(x => x.entityType === "PRICE_LIST_ITEM")
      .map(x => x.original.priceListId as string),
  ])];
  const permittedPriceList = {
    organizationId: scope.organizationId,
    OR: [
      { scopeType: "ORGANIZATION" as const, branchId: null },
      { scopeType: "BRANCH" as const, branchId: { in: [...activeBranches] } },
    ],
  };
  const [tests, units, components, intervals, lists, prices] = await Promise.all([
    tx.labTest.findMany({ where: { ...testWhere, id: { in: testIds } },
      select: { id: true, code: true, departmentId: true } }),
    tx.unit.findMany({ where: { organizationId: scope.organizationId, id: { in: unitIds } },
      select: { id: true, code: true } }),
    tx.testComponent.findMany({ where: { id: { in: componentIds }, test: testWhere },
      select: { id: true, code: true, testId: true, unitId: true } }),
    tx.referenceInterval.findMany({ where: {
      id: { in: parsed.ids.intervals },
      component: { test: testWhere },
      OR: [{ branchId: null }, { branchId: { in: [...activeBranches] } }],
    }, select: { id: true, componentId: true, branchId: true } }),
    tx.priceList.findMany({ where: { ...permittedPriceList, id: { in: priceListIds } },
      select: { id: true, code: true, scopeType: true, branchId: true } }),
    tx.priceListItem.findMany({ where: {
      id: { in: parsed.ids.prices }, priceList: permittedPriceList, test: testWhere,
    }, select: { id: true, priceListId: true, testId: true } }),
  ]);
  if (tests.length !== testIds.length || units.length !== unitIds.length ||
      components.length !== componentIds.length || intervals.length !== parsed.ids.intervals.length ||
      lists.length !== priceListIds.length || prices.length !== parsed.ids.prices.length) {
    return { error: "bundle_master_identity_or_scope_changed", httpStatus: 403 } as const;
  }
  const byId = <T extends { id: string }>(rows: T[]) => new Map(rows.map(x => [x.id, x]));
  const testMap = byId(tests), unitMap = byId(units), componentMap = byId(components);
  const intervalMap = byId(intervals), listMap = byId(lists), priceMap = byId(prices);
  for (const row of references) {
    const n = row.normalized, original = row.original;
    let consistent = true;
    if (row.entityType === "TEST") {
      const existing = testMap.get(row.identity);
      consistent = !!existing && existing.code === n.code && existing.departmentId === n.departmentId;
    } else if (row.entityType === "UNIT") {
      consistent = unitMap.get(row.identity)?.code === n.code;
    } else if (row.entityType === "COMPONENT") {
      const existing = componentMap.get(row.identity);
      consistent = !!existing && existing.testId === n.testId && existing.code === n.code &&
        existing.unitId === n.unitId && testMap.get(existing.testId)?.code === n.testCode;
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

    const created = await tx.catalogImportBatch.create({ data: {
      organizationId: scope.organizationId, sourceType: BUNDLE_REVIEW_SOURCE,
      sourceName, sourceChecksum: checksum, status: "DRAFT", validatedAt: null,
      createdByUserId: session.user.id,
      summary: { total: references.length, WARNING: references.length, reviewOnly: true,
        format: "family-lab-catalog-bundle", consistency: parsed.consistency,
        attestationStatus, exportedAt: parsed.exportedAt, counts: parsed.counts },
    }, select: { id: true } });
    await tx.catalogImportRow.createMany({ data: references.map((row, index) => ({
      batchId: created.id, rowNumber: index + 1, entityType: row.entityType,
      legacyKey: row.identity, status: "WARNING",
      sourceData: row.original as Prisma.InputJsonObject,
      normalizedData: row.normalized as Prisma.InputJsonObject,
      validationIssues: [
        { severity: "WARNING", code: "CONFIGURATION_BUNDLE_REVIEW_ONLY",
          message: "Source snapshot only. Approval, mapping and effective-date reconciliation are required; no configuration is applied." },
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
    await tx.auditEvent.create({ data: {
      organizationId: scope.organizationId, branchId: scope.branchId,
      actorUserId: session.user.id, action: "CATALOG_CONFIG_BUNDLE_REVIEW_STAGED",
      entityType: "CatalogImportBatch", entityId: created.id,
      newValues: { total: references.length, reviewOnly: true, attestationStatus, counts: parsed.counts },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    } });
    return created;
  }, { timeout: 30000 });
  if ("error" in outcome) return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus });
  return NextResponse.json({ id: outcome.id, status: "DRAFT", reviewOnly: true,
    summary: { total: references.length, WARNING: references.length, counts: parsed.counts } },
  { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
