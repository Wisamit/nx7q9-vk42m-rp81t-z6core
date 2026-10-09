import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function unitKey(value: string) {
  return value.trim().toUpperCase().replace(/[µμ]/g, "U").replace(/\s+/g, "").replace(/PER/g, "/").replace(/\.$/, "");
}
function unitCode(value: string) {
  const normalized = unitKey(value)
    .replace(/[^A-Z0-9/.*^-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return ("LEG_" + (normalized || "UNIT")).slice(0, 50);
}

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
  if (batch.sourceType === "CSV_REVIEW") return NextResponse.json({ error: "csv_review_is_not_clinical_import" }, { status: 409 });

  const existingUnits = await prisma.unit.findMany({ where: { organizationId: session.user.organizationId } });
  const unitByKey = new Map<string, typeof existingUnits[number]>();
  for (const unit of existingUnits) {
    unitByKey.set(unitKey(unit.symbol), unit);
    unitByKey.set(unitKey(unit.code), unit);
  }

  const testRows = batch.rows.filter((row) => row.entityType === "TEST" && row.importedEntityId);
  const rangeRows = batch.rows.filter((row) => row.entityType === "REFERENCE_INTERVAL" && row.status !== "IMPORTED");
  const importedIds = [...new Set(testRows.map(row => row.importedEntityId).filter((id): id is string => !!id))];
  if (importedIds.length) {
    const scopedTests = await prisma.labTest.findMany({
      where: { ...clinicalImportTestWhere(scope), id: { in: importedIds }, status: "ACTIVE" },
      select: { id: true },
    });
    if (scopedTests.length !== importedIds.length) {
      return NextResponse.json({ error: "legacy_test_department_or_branch_scope_denied" }, { status: 403 });
    }
  }

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

  await prisma.$transaction(async (tx) => {
    for (const raw of rawUnits) {
      const k = unitKey(raw);
      if (unitByKey.has(k)) continue;

      let code = unitCode(raw);
      let suffix = 2;
      while (await tx.unit.findUnique({ where: { organizationId_code: { organizationId: session.user.organizationId, code } } })) {
        code = (unitCode(raw).slice(0, 45) + "_" + suffix).slice(0, 50);
        suffix++;
      }

      const created = await tx.unit.create({
        data: {
          organizationId: session.user.organizationId,
          code,
          symbol: raw.slice(0, 50),
          nameEn: `Legacy unit: ${raw}`.slice(0, 150),
          status: "ACTIVE",
        },
      });
      unitByKey.set(k, created);
      createdUnits++;
    }

    for (const row of testRows) {
      const source = object(row.sourceData);
      const normalized = object(row.normalizedData);
      const raw = text(normalized.unit || source.unit || source.Unit || source["test unit"]);
      if (!raw || !row.importedEntityId) continue;
      const unit = unitByKey.get(unitKey(raw));
      if (!unit) continue;

      const test = await tx.labTest.findFirst({
        where: { ...clinicalImportTestWhere(scope), id: row.importedEntityId, status: "ACTIVE" },
        select: { id: true, defaultUnitId: true },
      });
      if (!test || test.defaultUnitId) continue;

      await tx.labTest.update({ where: { id: test.id }, data: { defaultUnitId: unit.id } });
      assignedTests++;
    }

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "LEGACY_UNITS_MATERIALIZED",
        entityType: "CatalogImportBatch",
        entityId: batch.id,
        newValues: { createdUnits, assignedTests, sourceUnitCount: rawUnits.size },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }, { timeout: 60000 });

  return NextResponse.json({ status: "ok", createdUnits, assignedTests, sourceUnitCount: rawUnits.size });
}
