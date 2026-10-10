import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";

function looseKey(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "");
}
function unitKey(value: string) {
  return value.trim().toUpperCase().replace(/[µμ]/g, "U").replace(/\s+/g, "").replace(/PER/g, "/");
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
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
    select: { id: true, sourceType: true },
  });
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  if ((batch.sourceType === "CSV_REVIEW" || batch.sourceType === "CONFIG_BUNDLE_REVIEW")) return NextResponse.json({ error: "csv_review_is_not_clinical_import" }, { status: 409 });

  const body = await request.json().catch(() => null) as {
    mappingType?: "TEST_ALIAS" | "UNIT_ALIAS";
    sourceValue?: string;
    targetId?: string;
  } | null;

  const mappingType = body?.mappingType;
  const sourceValue = typeof body?.sourceValue === "string" ? body.sourceValue.trim() : "";
  const targetId = typeof body?.targetId === "string" ? body.targetId : "";
  if (!mappingType || !sourceValue || !targetId || !["TEST_ALIAS", "UNIT_ALIAS"].includes(mappingType)) {
    return NextResponse.json({ error: "invalid_mapping" }, { status: 400 });
  }

  const normalizedSourceValue = mappingType === "TEST_ALIAS" ? looseKey(sourceValue) : unitKey(sourceValue);
  if (!normalizedSourceValue) return NextResponse.json({ error: "invalid_source_value" }, { status: 400 });

  let targetTestId: string | null = null;
  let targetUnitId: string | null = null;

  if (mappingType === "TEST_ALIAS") {
    const target = await prisma.labTest.findFirst({ where: { ...clinicalImportTestWhere(scope), id: targetId, status: "ACTIVE" }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "target_not_found" }, { status: 404 });
    targetTestId = target.id;
  } else {
    const target = await prisma.unit.findFirst({ where: { id: targetId, organizationId: session.user.organizationId }, select: { id: true } });
    if (!target) return NextResponse.json({ error: "target_not_found" }, { status: 404 });
    targetUnitId = target.id;
  }

  const mapping = await prisma.$transaction(async (tx) => {
    const saved = await tx.catalogImportMapping.upsert({
      where: {
        organizationId_mappingType_normalizedSourceValue: {
          organizationId: session.user.organizationId,
          mappingType,
          normalizedSourceValue,
        },
      },
      create: {
        organizationId: session.user.organizationId,
        mappingType,
        sourceValue,
        normalizedSourceValue,
        targetTestId,
        targetUnitId,
        createdByUserId: session.user.id,
      },
      update: {
        sourceValue,
        targetTestId,
        targetUnitId,
        createdByUserId: session.user.id,
      },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "CATALOG_IMPORT_MAPPING_SAVED",
        entityType: "CatalogImportMapping",
        entityId: saved.id,
        newValues: { mappingType, sourceValue, normalizedSourceValue, targetTestId, targetUnitId },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });

    return saved;
  });

  return NextResponse.json({ status: "ok", id: mapping.id });
}
