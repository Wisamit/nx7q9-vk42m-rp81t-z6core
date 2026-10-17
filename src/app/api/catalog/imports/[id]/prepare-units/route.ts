import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { liveLegacyClinicalWriteScope } from "@/lib/catalog-legacy-clinical-write-auth";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { eligibleLegacyUnitSourceRow, indexLegacyPreparedUnits, legacyPreparedUnitKey, proposedLegacyUnitCode, registerLegacyPreparedUnitAlias, resolveLegacyPreparedUnit } from "@/lib/catalog-legacy-unit-preparation";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.reference_ranges.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const scope = resolveClinicalImportScope({
    organizationId: session.user.organizationId, activeBranchId: session.activeBranchId,
    activeBranch: session.activeBranch, branchScopes: session.user.branchScopes,
    departmentScopes: session.user.departmentScopes,
  });
  if (!scope) return NextResponse.json({ error: "active_clinical_import_scope_required" }, { status: 403 });

  const batch = await prisma.catalogImportBatch.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: {
      rows: {
        where: { entityType: { in: ["TEST", "REFERENCE_INTERVAL"] } },
        orderBy: { rowNumber: "asc" },
      },
    },
  });
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  if ((batch.sourceType === "CSV_REVIEW" || batch.sourceType === "CONFIG_BUNDLE_REVIEW")) return NextResponse.json({ error: "csv_review_is_not_clinical_import" }, { status: 409 });

  // Lock the organization and batch before reading mutable source rows or units.
  // Two unit-preparation requests (even from different legacy batches) cannot
  // each create a separate unit for the same previously unseen source alias.
  let result: { createdUnits: number; assignedTests: number; sourceUnitCount: number; ambiguousUnits: number; unrepresentableUnits: number; unresolvedAssignments: number };
  try {
  result = await prisma.$transaction(async (tx) => {
    const ownedOrganization = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM organizations WHERE id = ${scope.organizationId} AND status = 'ACTIVE' FOR UPDATE`;
    if (ownedOrganization.length !== 1) throw new Error("legacy_unit_scope_changed");
    const ownedBatch = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM catalog_import_batches WHERE id = ${id} AND organization_id = ${scope.organizationId} FOR UPDATE`;
    if (ownedBatch.length !== 1) throw new Error("legacy_unit_batch_changed");
    const liveScope = await liveLegacyClinicalWriteScope(tx, {
      organizationId: scope.organizationId, userId: session.user.id,
      branchId: scope.branchId,
      sessionBranchIds: session.user.branchScopes.filter(item =>
        item.branch.status === "ACTIVE" && item.branch.organizationId === scope.organizationId
      ).map(item => item.branchId),
      sessionDepartmentIds: session.user.departmentScopes.map(item => item.departmentId),
    });
    if (!liveScope) throw new Error("legacy_unit_scope_changed");

    const currentBatch = await tx.catalogImportBatch.findFirst({
      where: { id, organizationId: scope.organizationId },
      include: { rows: {
        where: { entityType: { in: ["TEST", "REFERENCE_INTERVAL"] } },
        orderBy: { rowNumber: "asc" },
      } },
    });
    if (!currentBatch || (currentBatch.sourceType === "CSV_REVIEW" || currentBatch.sourceType === "CONFIG_BUNDLE_REVIEW") ||
        currentBatch.status === "FAILED") throw new Error("legacy_unit_batch_changed");

    const eligibleRows = currentBatch.rows.filter(eligibleLegacyUnitSourceRow);
    const testRows = eligibleRows.filter(row => row.entityType === "TEST");
    const rangeRows = eligibleRows.filter(row => row.entityType === "REFERENCE_INTERVAL");
    const importedIds = [...new Set(testRows.map(row => row.importedEntityId).filter((value): value is string => !!value))];
    if (importedIds.length) {
      const scopedTests = await tx.labTest.findMany({
        where: { ...clinicalImportTestWhere(liveScope), id: { in: importedIds }, status: "ACTIVE" },
        select: { id: true },
      });
      if (scopedTests.length !== importedIds.length) {
        throw new Error("legacy_test_department_or_branch_scope_denied");
      }
    }

    const units = await tx.unit.findMany({
      where: { organizationId: scope.organizationId },
      select: { id: true, code: true, symbol: true, status: true },
    });
    const unitByKey = indexLegacyPreparedUnits(units);
    const rawUnits = new Set<string>();
    for (const row of testRows) {
      const source = object(row.sourceData);
      const normalized = object(row.normalizedData);
      const raw = text(normalized.unit || source.unit || source.Unit || source["test unit"]);
      if (raw) rawUnits.add(raw);
    }
    for (const row of rangeRows) {
      const source = object(row.sourceData);
      const normalized = object(row.normalizedData);
      const raw = text(normalized.unit || source["test unit"] || source.unit || source.Unit);
      if (raw) rawUnits.add(raw);
    }

    let createdUnits = 0;
    let assignedTests = 0;
    let ambiguousUnits = 0;
    let unrepresentableUnits = 0;
    let unresolvedAssignments = 0;
    for (const raw of rawUnits) {
      const resolution = resolveLegacyPreparedUnit(unitByKey, raw);
      if (resolution.kind === "resolved") continue;
      if (resolution.kind === "ambiguous_or_inactive") {
        ambiguousUnits++;
        continue;
      }
      const baseCode = proposedLegacyUnitCode(raw);
      if (!baseCode) {
        unrepresentableUnits++;
        continue;
      }
      let code = baseCode;
      let suffixNumber = 2;
      while (unitByKey.has(legacyPreparedUnitKey(code)) ||
             await tx.unit.findUnique({ where: { organizationId_code: { organizationId: scope.organizationId, code } } })) {
        const suffix = "_" + suffixNumber++;
        if (baseCode.length + suffix.length > 50) break;
        code = baseCode + suffix;
      }
      if (unitByKey.has(legacyPreparedUnitKey(code)) ||
          await tx.unit.findUnique({ where: { organizationId_code: { organizationId: scope.organizationId, code } } })) {
        unrepresentableUnits++;
        continue;
      }
      const created = await tx.unit.create({
        data: { organizationId: scope.organizationId, code, symbol: raw, nameEn: `Legacy unit: ${raw}`,
          status: "ACTIVE" },
      });
      registerLegacyPreparedUnitAlias(unitByKey, created.code, created.id, created.status);
      registerLegacyPreparedUnitAlias(unitByKey, created.symbol, created.id, created.status);
      createdUnits++;
    }

    for (const row of testRows) {
      const source = object(row.sourceData);
      const normalized = object(row.normalizedData);
      const raw = text(normalized.unit || source.unit || source.Unit || source["test unit"]);
      if (!raw || !row.importedEntityId) continue;
      const unit = resolveLegacyPreparedUnit(unitByKey, raw);
      if (unit.kind !== "resolved") {
        unresolvedAssignments++;
        continue;
      }
      // CAS: a concurrent clinical catalog update wins without being overwritten.
      // Only current, imported and department/branch-scoped test definitions qualify.
      const claimed = await tx.labTest.updateMany({
        where: { ...clinicalImportTestWhere(liveScope), id: row.importedEntityId,
          defaultUnitId: null, status: "ACTIVE" },
        data: { defaultUnitId: unit.unitId },
      });
      assignedTests += claimed.count;
    }

    await tx.auditEvent.create({
      data: {
        organizationId: scope.organizationId, branchId: scope.branchId,
        actorUserId: session.user.id, action: "LEGACY_UNITS_MATERIALIZED",
        entityType: "CatalogImportBatch", entityId: currentBatch.id,
        newValues: { createdUnits, assignedTests, sourceUnitCount: rawUnits.size,
          ambiguousUnits, unrepresentableUnits, unresolvedAssignments },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      },
    });
    return { createdUnits, assignedTests, sourceUnitCount: rawUnits.size,
      ambiguousUnits, unrepresentableUnits, unresolvedAssignments };
  }, { timeout: 60000 });
  } catch (error) {
    if (error instanceof Error && (error.message === "legacy_unit_scope_changed" ||
        error.message === "legacy_test_department_or_branch_scope_denied")) {
      return NextResponse.json({ error: "legacy_test_department_or_branch_scope_denied" }, { status: 403 });
    }
    if (error instanceof Error && error.message === "legacy_unit_batch_changed") {
      return NextResponse.json({ error: "legacy_unit_batch_changed" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ status: "ok", ...result });

}
