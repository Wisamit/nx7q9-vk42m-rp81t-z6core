import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeImportRow, rowValidationStatus, validateImportRow, type ImportInputRow } from "@/lib/catalog-import";
import type { Prisma } from "../../../../../../../generated/prisma/client";

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
  // Revalidation must never reset imported/skipped clinical or catalog rows
  // to VALID/WARNING. Historical imported entity links are immutable.
  if (batch.status === "IMPORTED" || batch.status === "FAILED" ||
      batch.rows.some(row => row.status === "IMPORTED" || row.status === "SKIPPED" || row.importedEntityId !== null)) {
    return NextResponse.json({ error: "processed_import_batch_immutable" }, { status: 409 });
  }

  const prepared = batch.rows.map((row) => {
    const source = row.sourceData;
    if (!source || typeof source !== "object" || Array.isArray(source)) {
      return {
        row,
        normalized: {} as Prisma.InputJsonObject,
        issues: [{ severity: "ERROR" as const, code: "INVALID_SOURCE_DATA", message: "Staged source row is not a JSON object." }],
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

  const testCodeCounts = new Map<string, number>();
  for (const item of prepared) {
    if (item.row.entityType !== "TEST") continue;
    const code = typeof item.normalized.code === "string" ? item.normalized.code.trim().toUpperCase() : "";
    if (code) testCodeCounts.set(code, (testCodeCounts.get(code) || 0) + 1);
  }

  for (const item of prepared) {
    if (item.row.entityType !== "TEST") continue;
    const code = typeof item.normalized.code === "string" ? item.normalized.code.trim().toUpperCase() : "";
    if (code && (testCodeCounts.get(code) || 0) > 1) {
      item.issues.push({
        severity: "WARNING",
        code: "DUPLICATE_TEST_CODE",
        message: "More than one staged test resolves to the same code. These rows will remain excluded from safe import until reviewed.",
      });
    }
  }

  const counts: Record<string, number> = {};
  const updates = prepared.map((item) => {
    const status = rowValidationStatus(item.issues);
    counts[status] = (counts[status] || 0) + 1;
    return { ...item, status };
  });

  const nextBatchStatus = counts.ERROR ? "DRAFT" : "VALIDATED";

  try {
  await prisma.$transaction(async (tx) => {
    // A concurrent safe-master commit atomically moves the batch to IMPORTED.
    // Never revalidate using a snapshot from before that state transition.
    const batchClaim = await tx.catalogImportBatch.updateMany({
      where: {
        id: batch.id, organizationId: session.user.organizationId,
        status: { in: ["DRAFT", "VALIDATED"] },
        updatedAt: batch.updatedAt,
      },
      data: { updatedAt: new Date() },
    });
    if (batchClaim.count !== 1) throw new Error("catalog_revalidate_claim_conflict");
    for (const item of updates) {
      const claimed = await tx.catalogImportRow.updateMany({
        where: {
          id: item.row.id, batchId: batch.id,
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
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId,
        actorUserId: session.user.id,
        action: "CATALOG_IMPORT_REVALIDATED",
        entityType: "CatalogImportBatch",
        entityId: batch.id,
        newValues: { total: updates.length, ...counts, status: nextBatchStatus },
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
      },
    });
  }, { timeout: 30000 });
  } catch (error) {
    if (error instanceof Error && error.message === "catalog_revalidate_claim_conflict") {
      return NextResponse.json({ error: "processed_import_batch_immutable" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({ status: nextBatchStatus, summary: { total: updates.length, ...counts } });
}
