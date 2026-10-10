import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  isSafeMasterTestRow, registerPanelAlias, resolvedPanelMemberships, sameImportTestIdentity,
} from "@/lib/catalog-panel-membership";

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.manage");
  const ctx = await requestContext();
  const { id } = await params;

  const batch = await prisma.catalogImportBatch.findFirst({
    where: { id, organizationId: session.user.organizationId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  if (batch.sourceType === "CSV_REVIEW") return NextResponse.json({ error: "csv_review_is_not_committable" }, { status: 409 });
  if (batch.status !== "VALIDATED") return NextResponse.json({ error: "batch_not_validated" }, { status: 409 });

  const safeRows = batch.rows.filter(row =>
    (row.status === "VALID" && ["UNIT", "CONTAINER", "TEST", "PANEL"].includes(row.entityType)) ||
    isSafeMasterTestRow(row)
  );
  if (safeRows.length === 0) {
    return NextResponse.json({ error: "no_pending_safe_master_rows" }, { status: 409 });
  }
  const results = { imported: 0, skipped: 0, deferred: batch.rows.filter(row => ["REFERENCE_INTERVAL", "COMPONENT", "PRICE_LIST_ITEM"].includes(row.entityType)).length };

  try {
  await prisma.$transaction(async tx => {
    // Serialize import execution using the batch status row. Competing POSTs
    // can never both import the same master data; rollback releases the claim.
    const claim = await tx.catalogImportBatch.updateMany({
      where: { id: batch.id, organizationId: session.user.organizationId, status: "VALIDATED" },
      data: { status: "IMPORTED", importedAt: new Date() },
    });
    if (claim.count !== 1) throw new Error("catalog_import_claim_conflict");
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

    // Keep the exact eligible source row -> resolved master identity.
    // Test display names are not unique and must not determine panel members.
    const testBySourceRowId = new Map<string, string>();
    for (const row of safeRows.filter(row => row.entityType === "TEST")) {
      const n = asObject(row.normalizedData); const code = text(n.code).toUpperCase(); const nameEn = text(n.nameEn);
      const existing = code ? await tx.labTest.findUnique({ where: { organizationId_code: { organizationId: session.user.organizationId, code } } }) : null;
      if (!code || !nameEn || existing) {
        // Only an exact existing code AND matching display identity may be
        // reused for this eligible staged source row.
        if (existing && sameImportTestIdentity(existing.nameEn, nameEn)) {
          testBySourceRowId.set(row.id, existing.id);
        }
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
      testBySourceRowId.set(row.id, created.id);
      await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "IMPORTED", importedEntityId: created.id } }); results.imported++;
    }

    const panelMap = new Map<string, string | null>();
    for (const row of safeRows.filter(row => row.entityType === "PANEL")) {
      const n = asObject(row.normalizedData); const code = text(n.code).toUpperCase(); const nameEn = text(n.nameEn);
      const existingPanel = code ? await tx.testPanel.findUnique({
        where: { organizationId_code: { organizationId: session.user.organizationId, code } },
      }) : null;
      // A legacy panel code with a different current identity must not change
      // that panel's membership through an unapproved import.
      let panel = existingPanel && sameImportTestIdentity(existingPanel.nameEn, nameEn)
        ? existingPanel : null;
      if (!existingPanel && code && nameEn) {
        panel = await tx.testPanel.create({ data: {
          organizationId: session.user.organizationId, code: code.slice(0, 80),
          nameEn: nameEn.slice(0, 200),
        } });
      }
      if (!panel) {
        await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "SKIPPED", validationIssues: [{ severity: "WARNING", code: "INVALID_PANEL", message: "Panel could not be imported safely." }] } }); results.skipped++; continue;
      }
      registerPanelAlias(panelMap, nameEn, panel.id);
      registerPanelAlias(panelMap, code, panel.id);
      await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "IMPORTED", importedEntityId: panel.id } }); results.imported++;
    }

    const panelMemberships = resolvedPanelMemberships(safeRows, testBySourceRowId, panelMap);
    if (panelMemberships.length) {
      await tx.testPanelItem.createMany({ data: panelMemberships, skipDuplicates: true });
    }

    await tx.catalogImportBatch.update({ where: { id: batch.id }, data: { summary: { ...(asObject(batch.summary)), safeMasterImport: results } } });
    await tx.auditEvent.create({ data: {
      organizationId: session.user.organizationId, branchId: session.activeBranchId, actorUserId: session.user.id,
      action: "CATALOG_IMPORT_SAFE_MASTER_COMMITTED", entityType: "CatalogImportBatch", entityId: batch.id,
      newValues: results, ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    } });
  });
  } catch (error) {
    if (error instanceof Error && error.message === "catalog_import_claim_conflict") {
      return NextResponse.json({ error: "batch_already_committed" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ status: "ok", ...results });
}
