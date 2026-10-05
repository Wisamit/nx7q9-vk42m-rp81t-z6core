import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
function issueCodes(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const code = (item as Record<string, unknown>).code;
    return typeof code === "string" ? [code] : [];
  });
}
function isEligibleGeneratedTest(row: { entityType: string; status: string; validationIssues: unknown }) {
  if (row.entityType !== "TEST" || row.status !== "WARNING") return false;
  const codes = issueCodes(row.validationIssues);
  return codes.length === 1 && codes[0] === "GENERATED_TEST_CODE";
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.manage");
  const ctx = await requestContext();
  const { id } = await params;

  const batch = await prisma.catalogImportBatch.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  if (batch.status !== "VALIDATED") return NextResponse.json({ error: "batch_not_validated" }, { status: 409 });

  const safeRows = batch.rows.filter(row =>
    (row.status === "VALID" && ["UNIT", "CONTAINER", "TEST", "PANEL"].includes(row.entityType)) ||
    isEligibleGeneratedTest(row)
  );
  const results = { imported: 0, skipped: 0, deferred: batch.rows.filter(row => row.entityType === "REFERENCE_INTERVAL").length };

  await prisma.$transaction(async tx => {
    const units = new Map<string, string>();
    for (const existing of await tx.unit.findMany({ where: { organizationId: session.user.organizationId } })) {
      units.set(existing.code.toUpperCase(), existing.id);
      units.set(existing.symbol.toUpperCase(), existing.id);
    }

    for (const row of safeRows.filter(row => row.entityType === "UNIT")) {
      const n = asObject(row.normalizedData);
      const code = text(n.code).toUpperCase();
      const symbol = text(n.symbol);
      if (!code || !symbol || units.has(code) || units.has(symbol.toUpperCase())) {
        await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "SKIPPED", validationIssues: [{ severity: "WARNING", code: "DUPLICATE_OR_INVALID_UNIT", message: "Unit already exists or could not be imported safely." }] } });
        results.skipped++; continue;
      }
      const unit = await tx.unit.create({ data: { organizationId: session.user.organizationId, code: code.slice(0, 50), symbol: symbol.slice(0, 50), nameEn: symbol.slice(0, 150) } });
      units.set(code, unit.id); units.set(symbol.toUpperCase(), unit.id);
      await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "IMPORTED", importedEntityId: unit.id } });
      results.imported++;
    }

    for (const row of safeRows.filter(row => row.entityType === "CONTAINER")) {
      const n = asObject(row.normalizedData); const code = text(n.code).toUpperCase(); const nameEn = text(n.nameEn);
      const existing = code ? await tx.container.findUnique({ where: { organizationId_code: { organizationId: session.user.organizationId, code } } }) : null;
      if (!code || !nameEn || existing) {
        await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "SKIPPED", validationIssues: [{ severity: "WARNING", code: "DUPLICATE_OR_INVALID_CONTAINER", message: "Container already exists or could not be imported safely." }] } });
        results.skipped++; continue;
      }
      const created = await tx.container.create({ data: { organizationId: session.user.organizationId, code: code.slice(0, 50), nameEn: nameEn.slice(0, 150) } });
      await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "IMPORTED", importedEntityId: created.id } }); results.imported++;
    }

    const testByLegacyName = new Map<string, string>();
    for (const row of safeRows.filter(row => row.entityType === "TEST")) {
      const n = asObject(row.normalizedData); const code = text(n.code).toUpperCase(); const nameEn = text(n.nameEn);
      const existing = code ? await tx.labTest.findUnique({ where: { organizationId_code: { organizationId: session.user.organizationId, code } } }) : null;
      if (!code || !nameEn || existing) {
        if (existing) testByLegacyName.set(nameEn.toUpperCase(), existing.id);
        await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "SKIPPED", validationIssues: [{ severity: "WARNING", code: "DUPLICATE_OR_INVALID_TEST", message: "Test already exists or could not be imported safely; no existing definition was overwritten." }] } });
        results.skipped++; continue;
      }
      const unitText = text(n.unit).toUpperCase();
      const created = await tx.labTest.create({ data: {
        organizationId: session.user.organizationId, code: code.slice(0, 80), nameEn: nameEn.slice(0, 200),
        abbreviation: code.slice(0, 80), defaultUnitId: units.get(unitText) || null,
        assay: text(n.assay).slice(0, 200) || null, collectionInstructions: text(n.collection) || null,
      } });
      if (session.activeBranchId) await tx.testBranchAvailability.create({ data: { testId: created.id, branchId: session.activeBranchId, performedHere: true } });
      testByLegacyName.set(nameEn.toUpperCase(), created.id);
      await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "IMPORTED", importedEntityId: created.id } }); results.imported++;
    }

    const panelMap = new Map<string, string>();
    for (const row of safeRows.filter(row => row.entityType === "PANEL")) {
      const n = asObject(row.normalizedData); const code = text(n.code).toUpperCase(); const nameEn = text(n.nameEn);
      let panel = code ? await tx.testPanel.findUnique({ where: { organizationId_code: { organizationId: session.user.organizationId, code } } }) : null;
      if (!panel && code && nameEn) panel = await tx.testPanel.create({ data: { organizationId: session.user.organizationId, code: code.slice(0, 80), nameEn: nameEn.slice(0, 200) } });
      if (!panel) {
        await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "SKIPPED", validationIssues: [{ severity: "WARNING", code: "INVALID_PANEL", message: "Panel could not be imported safely." }] } }); results.skipped++; continue;
      }
      panelMap.set(nameEn.toUpperCase(), panel.id); panelMap.set(code, panel.id);
      await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "IMPORTED", importedEntityId: panel.id } }); results.imported++;
    }

    const testRows = batch.rows.filter(row => row.entityType === "TEST");
    for (const row of testRows) {
      const n = asObject(row.normalizedData); const panelName = text(n.panel); const testName = text(n.nameEn);
      if (!panelName || !testName) continue;
      const panelId = panelMap.get(panelName.toUpperCase()) || panelMap.get(panelName.replace(/\s+/g, "_").toUpperCase());
      const testId = row.importedEntityId || testByLegacyName.get(testName.toUpperCase());
      if (panelId && testId) await tx.testPanelItem.createMany({ data: [{ panelId, testId, displayOrder: 0, required: true }], skipDuplicates: true });
    }

    await tx.catalogImportBatch.update({ where: { id: batch.id }, data: { summary: { ...(asObject(batch.summary)), safeMasterImport: results } } });
    await tx.auditEvent.create({ data: {
      organizationId: session.user.organizationId, branchId: session.activeBranchId, actorUserId: session.user.id,
      action: "CATALOG_IMPORT_SAFE_MASTER_COMMITTED", entityType: "CatalogImportBatch", entityId: batch.id,
      newValues: results, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    } });
  });

  return NextResponse.json({ status: "ok", ...results });
}
