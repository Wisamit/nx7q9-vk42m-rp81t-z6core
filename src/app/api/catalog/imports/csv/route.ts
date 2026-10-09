import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Prisma } from "../../../../../../generated/prisma/client";
import { normalizeImportRow, rowValidationStatus, validateImportRow } from "@/lib/catalog-import";
import { CsvStagingError, CSV_STAGE_MAX_BYTES, parseCsvReviewFile } from "@/lib/catalog-review-csv-import";

export async function POST(request: Request) {
  const session = await requirePermission("catalog.manage");
  const permissions = permissionSet(session);
  if (!session.user.branchScopes.some(scope => scope.branch.status === "ACTIVE")) {
    return NextResponse.json({ error: "active_branch_scope_required" }, { status: 403 });
  }
  const contentType = request.headers.get("content-type") || "";
  if (!/^text\/csv(?:\s*;|$)/i.test(contentType)) {
    return NextResponse.json({ error: "csv_content_type_required" }, { status: 415 });
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(length) || length < 0 || length > CSV_STAGE_MAX_BYTES) {
    return NextResponse.json({ error: "csv_file_too_large" }, { status: 413 });
  }
  const sourceName = new URL(request.url).searchParams.get("sourceName")?.trim() ?? "";
  if (!sourceName || sourceName.length > 255 || /[\x00-\x1f\x7f]/.test(sourceName)) {
    return NextResponse.json({ error: "invalid_csv_source_name" }, { status: 400 });
  }
  const csvText = await request.text();
  let inputs: ReturnType<typeof parseCsvReviewFile>;
  try {
    inputs = parseCsvReviewFile(csvText);
  } catch (error) {
    if (error instanceof CsvStagingError) {
      return NextResponse.json({ error: error.reason }, { status: 400 });
    }
    throw error;
  }
  if (inputs.some(row => row.entityType === "PRICE_LIST_ITEM") && !permissions.has("pricing.manage")) {
    return NextResponse.json({ error: "pricing_manage_required" }, { status: 403 });
  }
  const prepared = inputs.map((row, index) => {
    const normalized = normalizeImportRow(row);
    const issues = validateImportRow(row.entityType, normalized);
    return { row, rowNumber: index + 1, normalized, issues, status: rowValidationStatus(issues) };
  });
  const summary = prepared.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const checksum = createHash("sha256").update(csvText).digest("hex");
  const ctx = await requestContext();

  // Always DRAFT, never VALIDATED: this path is for evidence review only.
  // Existing revalidation and commit routes deny CSV_REVIEW at their boundaries.
  const batch = await prisma.$transaction(async tx => {
    const created = await tx.catalogImportBatch.create({
      data: {
        organizationId: session.user.organizationId,
        sourceType: "CSV_REVIEW", sourceName, sourceChecksum: checksum,
        status: "DRAFT", validatedAt: null, createdByUserId: session.user.id,
        summary: { total: prepared.length, ...summary, reviewOnly: true },
      },
      select: { id: true },
    });
    await tx.catalogImportRow.createMany({
      data: prepared.map(item => ({
        batchId: created.id, rowNumber: item.rowNumber,
        entityType: item.row.entityType,
        legacyKey: item.row.legacyKey || null,
        status: item.status,
        sourceData: item.row.data,
        normalizedData: item.normalized,
        validationIssues: item.issues as Prisma.InputJsonArray,
      })),
    });
    await tx.auditEvent.create({
      data: {
        organizationId: session.user.organizationId,
        branchId: session.activeBranchId, actorUserId: session.user.id,
        action: "CATALOG_CSV_REVIEW_STAGED", entityType: "CatalogImportBatch",
        entityId: created.id, newValues: {
          total: prepared.length, valid: summary.VALID || 0,
          warnings: summary.WARNING || 0, errors: summary.ERROR || 0,
          reviewOnly: true,
        },
        ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
      },
    });
    return created;
  }, { timeout: 30000 });
  return NextResponse.json({
    id: batch.id, status: "DRAFT", reviewOnly: true,
    summary: { total: prepared.length, ...summary },
  }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
}
