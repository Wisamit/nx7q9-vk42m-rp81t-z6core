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

  await prisma.$transaction(async (tx) => {
    for (const item of updates) {
      await tx.catalogImportRow.update({
        where: { id: item.row.id },
        data: {
          normalizedData: item.normalized,
          validationIssues: item.issues as Prisma.InputJsonArray,
          status: item.status,
        },
      });
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

  return NextResponse.json({ status: nextBatchStatus, summary: { total: updates.length, ...counts } });
}
