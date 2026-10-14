import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  isSafeMasterTestRow, registerPanelAlias, resolvedPanelMemberships,
} from "@/lib/catalog-panel-membership";
import { fitsSafeMasterIdentity, registerSafeMasterUnitAlias, resolveSafeMasterUnitAlias, sameSafeMasterTestDefinition } from "@/lib/catalog-safe-master-units";
import { manualUnitIdentityError } from "@/lib/catalog-manual-unit-governance";

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
  if ((batch.sourceType === "CSV_REVIEW" || batch.sourceType === "CONFIG_BUNDLE_REVIEW")) return NextResponse.json({ error: "csv_review_is_not_committable" }, { status: 409 });
  if (batch.status !== "VALIDATED") return NextResponse.json({ error: "batch_not_validated" }, { status: 409 });

  const safeRows = batch.rows.filter(row =>
    (row.status === "VALID" && ["UNIT", "CONTAINER", "TEST", "PANEL"].includes(row.entityType)) ||
    isSafeMasterTestRow(row)
  );
  if (safeRows.length === 0) {
    return NextResponse.json({ error: "no_pending_safe_master_rows" }, { status: 409 });
  }
  const results = { imported: 0, skipped: 0, deferred: batch.rows.filter(row => ["REFERENCE_INTERVAL", "COMPONENT", "PRICE_LIST_ITEM", "PRICE_LIST_PACKAGE_ITEM", "PACKAGE"].includes(row.entityType)).length };

  try {
  await prisma.$transaction(async tx => {
    // Coordinate with other master import transactions and Stage 45 unit
    // preparation. The organization lock covers all batches in this tenant,
    // not just two POSTs targeting the same batch.
    const ownerLock = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM organizations
      WHERE id = ${session.user.organizationId} FOR UPDATE
    `;
    if (ownerLock.length !== 1) throw new Error("catalog_import_organization_changed");
    const latestBatch = await tx.catalogImportBatch.findFirst({
      where: { id: batch.id, organizationId: session.user.organizationId, status: "VALIDATED" },
      include: { rows: { orderBy: { rowNumber: "asc" } } },
    });
    if (!latestBatch || latestBatch.sourceType === "CONFIG_BUNDLE_REVIEW" ||
      latestBatch.sourceType === "CSV_REVIEW") throw new Error("catalog_import_claim_conflict");
    // Never use a pre-lock source-row snapshot to write clinical master data.
    const safeRows = latestBatch.rows.filter(row =>
      (row.status === "VALID" && ["UNIT", "CONTAINER", "TEST", "PANEL"].includes(row.entityType)) ||
      isSafeMasterTestRow(row)
    );
    if (safeRows.length === 0) throw new Error("catalog_import_no_safe_rows");
    results.deferred = latestBatch.rows.filter(row =>
      ["REFERENCE_INTERVAL", "COMPONENT", "PRICE_LIST_ITEM"].includes(row.entityType)).length;
    const branch = session.activeBranchId ? await tx.branch.findFirst({
      where: { id: session.activeBranchId, organizationId: session.user.organizationId, status: "ACTIVE" },
      select: { id: true },
    }) : null;
    if (!branch || !session.user.branchScopes.some(grant =>
      grant.branchId === branch.id && grant.branch.status === "ACTIVE")) {
      throw new Error("catalog_import_branch_scope_changed");
    }
    // Serialize import execution using the batch status row. Competing POSTs
    // can never both import the same master data; rollback releases the claim.
    const claim = await tx.catalogImportBatch.updateMany({
      where: { id: batch.id, organizationId: session.user.organizationId, status: "VALIDATED" },
      data: { status: "IMPORTED", importedAt: new Date() },
    });
    if (claim.count !== 1) throw new Error("catalog_import_claim_conflict");
    const units = new Map<string, string | null>();
    const knownUnitIdentities = await tx.unit.findMany({
      where: { organizationId: session.user.organizationId },
      select: { id: true, code: true, symbol: true, status: true },
    });
    for (const existing of knownUnitIdentities) {
      registerSafeMasterUnitAlias(units, existing.code, existing.id);
      registerSafeMasterUnitAlias(units, existing.symbol, existing.id);
    }

    for (const row of safeRows.filter(row => row.entityType === "UNIT")) {
      const n = asObject(row.normalizedData);
      const code = text(n.code).toUpperCase();
      const symbol = text(n.symbol);
      if (!fitsSafeMasterIdentity(code, symbol, 50, 50) ||
        manualUnitIdentityError(knownUnitIdentities, { code, symbol }) ||
        units.has(code) || units.has(symbol.toUpperCase())) {
        await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "SKIPPED", validationIssues: [{ severity: "WARNING", code: "DUPLICATE_OR_INVALID_UNIT", message: "Unit already exists or could not be imported safely." }] } });
        results.skipped++; continue;
      }
      const unit = await tx.unit.create({ data: { organizationId: session.user.organizationId, code: code.slice(0, 50), symbol: symbol.slice(0, 50), nameEn: symbol.slice(0, 150) } });
      registerSafeMasterUnitAlias(units, code, unit.id);
      registerSafeMasterUnitAlias(units, symbol, unit.id);
      knownUnitIdentities.push({ id: unit.id, code: unit.code, symbol: unit.symbol, status: unit.status });
      await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "IMPORTED", importedEntityId: unit.id } });
      results.imported++;
    }

    for (const row of safeRows.filter(row => row.entityType === "CONTAINER")) {
      const n = asObject(row.normalizedData); const code = text(n.code).toUpperCase(); const nameEn = text(n.nameEn);
      const existing = code ? await tx.container.findUnique({ where: { organizationId_code: { organizationId: session.user.organizationId, code } } }) : null;
      if (!fitsSafeMasterIdentity(code, nameEn, 50, 150) || existing) {
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
      const sourceUnit = resolveSafeMasterUnitAlias(units, text(n.unit));
      const existing = code ? await tx.labTest.findUnique({ where: { organizationId_code: { organizationId: session.user.organizationId, code } } }) : null;
      if (!fitsSafeMasterIdentity(code, nameEn, 80, 200) || !sourceUnit.ok || existing) {
        // Reusing a test for a panel requires matching its clinical definition,
        // not just its display name. Unknown/ambiguous units must never silently
        // become NULL or resolve to whichever existing alias was loaded last.
        if (existing && sourceUnit.ok && fitsSafeMasterIdentity(code, nameEn, 80, 200) &&
          sameSafeMasterTestDefinition(existing, { nameEn, unitId: sourceUnit.unitId,
            assay: text(n.assay), collection: text(n.collection) })) {
          testBySourceRowId.set(row.id, existing.id);
        }
        const issue = sourceUnit.ok ? "DUPLICATE_OR_INVALID_TEST" : sourceUnit.reason;
        await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "SKIPPED", validationIssues: [{ severity: "WARNING", code: issue, message: "Test definition or source unit could not be imported safely; no existing definition was overwritten." }] } });
        results.skipped++; continue;
      }
      const created = await tx.labTest.create({ data: {
        organizationId: session.user.organizationId, code: code.slice(0, 80), nameEn: nameEn.slice(0, 200),
        abbreviation: code.slice(0, 80), defaultUnitId: sourceUnit.unitId,
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
      // An unapproved MDB profile cannot modify an active panel's clinical
      // membership, even if its code and name happen to match. Only create
      // new INACTIVE definitions pending independent profile sign-off.
      let panel = null as Awaited<ReturnType<typeof tx.testPanel.create>> | null;
      if (!existingPanel && fitsSafeMasterIdentity(code, nameEn, 80, 200)) {
        panel = await tx.testPanel.create({ data: {
          organizationId: session.user.organizationId, code: code.slice(0, 80),
          nameEn: nameEn.slice(0, 200),
          status: "INACTIVE", deactivatedAt: new Date(),
        } });
      }
      if (!panel) {
        await tx.catalogImportRow.update({ where: { id: row.id }, data: { status: "SKIPPED", validationIssues: [{ severity: "WARNING", code: "EXISTING_OR_INVALID_PANEL_PENDING_REVIEW", message: "Legacy panel cannot be activated or used to change existing membership without independent review." }] } }); results.skipped++; continue;
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
    if (error instanceof Error && (error.message === "catalog_import_claim_conflict" ||
      error.message === "catalog_import_no_safe_rows")) {
      return NextResponse.json({ error: "batch_already_committed" }, { status: 409 });
    }
    if (error instanceof Error && error.message === "catalog_import_branch_scope_changed") {
      return NextResponse.json({ error: "branch_forbidden" }, { status: 403 });
    }
    throw error;
  }

  return NextResponse.json({ status: "ok", ...results });
}
