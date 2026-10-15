import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import type { Prisma } from "../../../../../../generated/prisma/client";
import { normalizeImportRow, rowValidationStatus, validateImportRow } from "@/lib/catalog-import";
import { CsvStagingError, CSV_STAGE_MAX_BYTES, parseCsvReviewFile } from "@/lib/catalog-review-csv-import";
import { xlsxReviewToCsv, XlsxStagingError, XLSX_STAGE_MAX_BYTES } from "@/lib/catalog-review-xlsx-import";
import { validateRangeCsvReview } from "@/lib/catalog-range-csv-review";
import { validateExpandedCsvReviewRow } from "@/lib/catalog-expanded-csv-review";
import { resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";

export async function POST(request: Request) {
  const session = await requirePermission("catalog.manage");
  const permissions = permissionSet(session);
  if (!session.user.branchScopes.some(scope => scope.branch.status === "ACTIVE")) {
    return NextResponse.json({ error: "active_branch_scope_required" }, { status: 403 });
  }
  const contentType = request.headers.get("content-type") || "";
  const isXlsx = /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet(?:\s*;|$)/i.test(contentType);
  if (!isXlsx && !/^text\/csv(?:\s*;|$)/i.test(contentType)) {
    return NextResponse.json({ error: "csv_or_xlsx_content_type_required" }, { status: 415 });
  }
  const uploadLimit = isXlsx ? XLSX_STAGE_MAX_BYTES : CSV_STAGE_MAX_BYTES;
  const length = Number(request.headers.get("content-length") || 0);
  if (!Number.isFinite(length) || length < 0 || length > uploadLimit) {
    return NextResponse.json({ error: "csv_file_too_large" }, { status: 413 });
  }
  const sourceName = new URL(request.url).searchParams.get("sourceName")?.trim() ?? "";
  if (!sourceName.toLowerCase().endsWith(isXlsx ? ".xlsx" : ".csv")) {
    return NextResponse.json({ error: "invalid_review_file_extension" }, { status: 400 });
  }
  if (!sourceName || sourceName.length > 255 || [...sourceName].some(char => {
    const code = char.charCodeAt(0);
    return code < 32 || code === 127;
  })) {
    return NextResponse.json({ error: "invalid_csv_source_name" }, { status: 400 });
  }
  // Enforce the byte limit while reading, not after buffering untrusted input.
  const reader = request.body?.getReader();
  if (!reader) return NextResponse.json({ error: "csv_invalid_content" }, { status: 400 });
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.byteLength;
    if (bytes > CSV_STAGE_MAX_BYTES || bytes > uploadLimit) {
      await reader.cancel("csv_file_too_large");
      return NextResponse.json({ error: "csv_file_too_large" }, { status: 413 });
    }
    chunks.push(next.value);
  }
  const rawUpload = Buffer.concat(chunks);
  let csvText: string;
  try {
    csvText = isXlsx ? xlsxReviewToCsv(rawUpload) :
      new TextDecoder("utf-8", { fatal: true }).decode(rawUpload);
  } catch (error) {
    if (error instanceof CsvStagingError || error instanceof XlsxStagingError) {
      return NextResponse.json({ error: error.reason }, { status: 400 });
    }
    return NextResponse.json({ error: isXlsx ? "xlsx_invalid_workbook" : "csv_invalid_utf8" }, { status: 400 });
  }
  let inputs: ReturnType<typeof parseCsvReviewFile>;
  try {
    inputs = parseCsvReviewFile(csvText);
  } catch (error) {
    if (error instanceof CsvStagingError || error instanceof XlsxStagingError) {
      return NextResponse.json({ error: error.reason }, { status: 400 });
    }
    throw error;
  }
  if (inputs.some(row => row.entityType.startsWith("PRICE_")) && !permissions.has("pricing.manage")) {
    return NextResponse.json({ error: "pricing_manage_required" }, { status: 403 });
  }
  if (inputs.some(row => row.entityType === "REFERENCE_INTERVAL") &&
      !permissions.has("catalog.reference_ranges.manage")) {
    return NextResponse.json({ error: "reference_ranges_manage_required" }, { status: 403 });
  }
  if (inputs.some(row => !["UNIT", "CONTAINER"].includes(row.entityType))) {
    const clinicalScope = resolveClinicalImportScope({
      organizationId: session.user.organizationId,
      activeBranchId: session.activeBranchId, activeBranch: session.activeBranch,
      branchScopes: session.user.branchScopes,
      departmentScopes: session.user.departmentScopes,
    });
    if (!clinicalScope) {
      return NextResponse.json({ error: "active_clinical_import_scope_required" }, { status: 403 });
    }
  }
  // Review-only finance sources still require a currently authorized active
  // branch; otherwise even an uncommitted draft can expose foreign metadata.
  const priceLists = inputs.filter(row => row.entityType === "PRICE_LIST");
  if (priceLists.length) {
    const live = await prisma.branch.findMany({
      where: { organizationId: session.user.organizationId, status: "ACTIVE",
        id: { in: session.user.branchScopes.filter(scope =>
          scope.branch.organizationId === session.user.organizationId &&
          scope.branch.status === "ACTIVE"
        ).map(scope => scope.branchId) } },
      select: { id: true },
    });
    const authorizedIds = new Set(live.map(row => row.id));
    if (priceLists.some(row => {
      const normalized = normalizeImportRow(row);
      return normalized.scopeType === "BRANCH" &&
        (typeof normalized.branchId !== "string" || !authorizedIds.has(normalized.branchId));
    })) return NextResponse.json({ error: "price_list_branch_scope_forbidden" }, { status: 403 });
  }
  const prepared = inputs.map((row, index) => {
    const normalized = normalizeImportRow(row);
    const issues = [
      ...validateImportRow(row.entityType, normalized),
      ...validateExpandedCsvReviewRow(row.entityType, normalized),
      ...validateRangeCsvReview(row),
    ];
    return { row, rowNumber: index + 1, normalized, issues, status: rowValidationStatus(issues) };
  });
  const summary = prepared.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] || 0) + 1;
    return counts;
  }, {} as Record<string, number>);
  const checksum = createHash("sha256").update(rawUpload).digest("hex");
  const ctx = await requestContext();

  // Always DRAFT, never VALIDATED: this path is for evidence review only.
  // Existing revalidation and commit routes deny CSV_REVIEW at their boundaries.
  const batch = await prisma.$transaction(async tx => {
    const created = await tx.catalogImportBatch.create({
      data: {
        organizationId: session.user.organizationId,
        sourceType: "CSV_REVIEW", sourceName, sourceChecksum: checksum,
        status: "DRAFT", validatedAt: null, createdByUserId: session.user.id,
        summary: { total: prepared.length, ...summary, reviewOnly: true,
          uploadedFormat: isXlsx ? "XLSX" : "CSV" },
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
        action: isXlsx ? "CATALOG_XLSX_REVIEW_STAGED" : "CATALOG_CSV_REVIEW_STAGED",
        entityType: "CatalogImportBatch",
        entityId: created.id, newValues: {
          total: prepared.length, valid: summary.VALID || 0,
          warnings: summary.WARNING || 0, errors: summary.ERROR || 0,
          reviewOnly: true, uploadedFormat: isXlsx ? "XLSX" : "CSV",
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
