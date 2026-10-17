import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { liveCatalogReviewStagingAuthority } from "@/lib/catalog-review-staging-auth";
import {
  normalizeImportRow, rowValidationStatus, validateImportRow, type ImportInputRow,
} from "@/lib/catalog-import";
import type { Prisma } from "../../../../../../../generated/prisma/client";

/**
 * Revalidate only the owner's unprocessed legacy staging evidence.
 * All source normalization happens AFTER the active-tenant serialization lock
 * and live authorization checks. Do not revalidate stale pre-lock row copies.
 */
export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const organizationId = session.user.organizationId;

  try {
    const outcome = await prisma.$transaction(async tx => {
      const lock = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM organizations WHERE id=${organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      if (lock.length !== 1)
        return { error: "catalog_revalidate_organization_inactive", httpStatus: 403 } as const;

      const batch = await tx.catalogImportBatch.findFirst({
        where: { id, organizationId, createdByUserId: session.user.id },
        include: { rows: { orderBy: { rowNumber: "asc" } } },
      });
      if (!batch) return { error: "batch_not_found", httpStatus: 404 } as const;
      if (batch.sourceType !== "LEGACY_MDB_EXPORT")
        return { error: "csv_review_is_not_committable", httpStatus: 409 } as const;

      const live = await liveCatalogReviewStagingAuthority(tx, {
        userId: session.user.id, organizationId,
        activeBranchId: session.activeBranchId || "",
        sessionBranchIds: session.user.branchScopes.filter(item =>
          item.branch.organizationId === organizationId && item.branch.status === "ACTIVE"
        ).map(item => item.branchId),
        sessionDepartmentIds: session.user.departmentScopes.map(item => item.departmentId),
        needsPricing: batch.rows.some(row => row.entityType.startsWith("PRICE_")),
        needsRanges: batch.rows.some(row => row.entityType === "REFERENCE_INTERVAL"),
        needsClinicalScope: batch.rows.some(row =>
          !["UNIT", "CONTAINER"].includes(row.entityType)),
      });
      if (!live)
        return { error: "catalog_revalidate_authority_revoked", httpStatus: 403 } as const;

      // Never reopen imported, skipped or completed catalog/clinical evidence.
      if (batch.status === "IMPORTED" || batch.status === "FAILED" ||
          batch.rows.some(row => row.status === "IMPORTED" ||
            row.status === "SKIPPED" || row.importedEntityId !== null))
        return { error: "processed_import_batch_immutable", httpStatus: 409 } as const;

      const prepared = batch.rows.map(row => {
        const source = row.sourceData;
        if (!source || typeof source !== "object" || Array.isArray(source)) {
          return {
            row, normalized: {} as Prisma.InputJsonObject,
            issues: [{ severity: "ERROR" as const, code: "INVALID_SOURCE_DATA",
              message: "Staged source row is not a JSON object." }],
          };
        }
        const input: ImportInputRow = {
          entityType: row.entityType as ImportInputRow["entityType"],
          legacyKey: row.legacyKey || undefined,
          data: source as Prisma.InputJsonObject,
        };
        const normalized = normalizeImportRow(input);
        const issues = validateImportRow(input.entityType, normalized);
        return { row, normalized, issues };
      });
      const codes = new Map<string, number>();
      for (const item of prepared) {
        if (item.row.entityType !== "TEST") continue;
        const code = typeof item.normalized.code === "string"
          ? item.normalized.code.trim().toUpperCase() : "";
        if (code) codes.set(code, (codes.get(code) || 0) + 1);
      }
      for (const item of prepared) {
        if (item.row.entityType !== "TEST") continue;
        const code = typeof item.normalized.code === "string"
          ? item.normalized.code.trim().toUpperCase() : "";
        if (code && (codes.get(code) || 0) > 1) {
          item.issues.push({
            severity: "WARNING", code: "DUPLICATE_TEST_CODE",
            message: "More than one staged test resolves to the same code. These rows will remain excluded from safe import until reviewed.",
          });
        }
      }
      const counts: Record<string, number> = {};
      const updates = prepared.map(item => {
        const status = rowValidationStatus(item.issues);
        counts[status] = (counts[status] || 0) + 1;
        return { ...item, status };
      });
      const nextBatchStatus = counts.ERROR ? "DRAFT" : "VALIDATED";
      const claim = await tx.catalogImportBatch.updateMany({
        where: {
          id: batch.id, organizationId, createdByUserId: session.user.id,
          status: { in: ["DRAFT", "VALIDATED"] }, updatedAt: batch.updatedAt,
        },
        data: { updatedAt: new Date() },
      });
      if (claim.count !== 1) throw new Error("catalog_revalidate_claim_conflict");

      for (const item of updates) {
        const claimed = await tx.catalogImportRow.updateMany({
          where: {
            id: item.row.id, batchId: batch.id, updatedAt: item.row.updatedAt,
            status: { notIn: ["IMPORTED", "SKIPPED"] }, importedEntityId: null,
          },
          data: {
            normalizedData: item.normalized,
            validationIssues: item.issues as Prisma.InputJsonArray,
            status: item.status,
          },
        });
        if (claimed.count !== 1) throw new Error("catalog_revalidate_claim_conflict");
      }

      await tx.catalogImportBatch.update({
        where: { id: batch.id },
        data: {
          status: nextBatchStatus,
          validatedAt: nextBatchStatus === "VALIDATED" ? new Date() : null,
          summary: { total: updates.length, ...counts },
        },
      });
      await tx.auditEvent.create({
        data: {
          organizationId, branchId: session.activeBranchId,
          actorUserId: session.user.id,
          action: "CATALOG_IMPORT_REVALIDATED", entityType: "CatalogImportBatch",
          entityId: batch.id,
          newValues: { total: updates.length, ...counts, status: nextBatchStatus },
          ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
        },
      });
      return { status: nextBatchStatus, summary: { total: updates.length, ...counts } } as const;
    }, { isolationLevel: "RepeatableRead", timeout: 60000 });
    if ("error" in outcome)
      return NextResponse.json({ error: outcome.error }, { status: outcome.httpStatus });
    return NextResponse.json(outcome);
  } catch (error) {
    if (error instanceof Error && error.message === "catalog_revalidate_claim_conflict")
      return NextResponse.json({ error: "processed_import_batch_immutable" }, { status: 409 });
    throw error;
  }
}
