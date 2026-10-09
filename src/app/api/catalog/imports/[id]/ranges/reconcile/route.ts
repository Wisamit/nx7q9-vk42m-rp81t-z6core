import { NextResponse } from "next/server";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { rangeReviewCandidate, reconcileRangeReviewCandidate, stagedRangeContextIndex, stagedRangeContextIssue, stagedRangeAgeOverlapIndex, stagedRangeAgeOverlapIssue } from "@/lib/catalog-range-import-reconciliation";

const PAGE_SIZE = 100;
const issues = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(item => {
  if (!item || typeof item !== "object" || Array.isArray(item)) return [];
  const row = item as Record<string,unknown>;
  return row.severity === "ERROR" && typeof row.code === "string" ? [row.code] : [];
}) : [];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.reference_ranges.manage");
  if (!permissionSet(session).has("catalog.manage")) {
    return NextResponse.json({ error: "catalog_permission_required" }, { status: 403 });
  }
  const scope = resolveClinicalImportScope({
    organizationId: session.user.organizationId, activeBranchId: session.activeBranchId,
    activeBranch: session.activeBranch, branchScopes: session.user.branchScopes,
    departmentScopes: session.user.departmentScopes,
  });
  if (!scope) return NextResponse.json({ error: "active_clinical_import_scope_required" }, { status: 403 });
  const raw = new URL(request.url).searchParams.get("after");
  if (raw !== null && (!/^[1-9]\d{0,8}$/.test(raw) || Number(raw) > 100000000)) {
    return NextResponse.json({ error: "invalid_row_cursor" }, { status: 400 });
  }
  const after = raw === null ? 0 : Number(raw);
  const { id } = await params;
  const batch = await prisma.catalogImportBatch.findFirst({
    where: { id, organizationId: scope.organizationId, sourceType: "CSV_REVIEW",
      createdByUserId: session.user.id },
    select: { id: true, status: true },
  });
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });

  const staged = await prisma.catalogImportRow.findMany({
    where: { batchId: batch.id, entityType: "REFERENCE_INTERVAL", rowNumber: { gt: after } },
    orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
    select: { rowNumber: true, status: true, normalizedData: true, validationIssues: true },
    take: PAGE_SIZE + 1,
  });
  // A page-local duplicate check could miss a conflicting row on a later page.
  // Canonical CSV staging is limited to 20,000 rows; fail closed on overflow.
  const allStaged = await prisma.catalogImportRow.findMany({
    where: { batchId: batch.id, entityType: "REFERENCE_INTERVAL", status: { in: ["VALID", "WARNING"] } },
    select: { normalizedData: true, status: true },
    take: 20001,
  });
  if (allStaged.length > 20000) {
    return NextResponse.json({ error: "range_review_row_limit_exceeded" }, { status: 409 });
  }
  const contextIndex = stagedRangeContextIndex(allStaged);
  const ageOverlaps = stagedRangeAgeOverlapIndex(allStaged);
  const page = staged.slice(0, PAGE_SIZE);
  const candidates = page.map(row => rangeReviewCandidate(row.normalizedData));
  const [tests, units] = await Promise.all([
    prisma.labTest.findMany({
      where: clinicalImportTestWhere(scope),
      select: {
        id: true, code: true, nameEn: true, status: true, defaultUnitId: true,
        components: { select: { id: true, unitId: true, status: true } },
      },
    }),
    prisma.unit.findMany({
      where: { organizationId: scope.organizationId, status: "ACTIVE" },
      select: { id: true, code: true, symbol: true, status: true },
    }),
  ]);
  const rows = page.map((row, i) => {
    const result = reconcileRangeReviewCandidate(candidates[i], tests, units, issues(row.validationIssues));
    // An unresolved scoped test cannot disclose its raw staged clinical context
    // or source validation metadata through this additional review endpoint.
    const resolved = result.testId !== null;
    const contextIssue = resolved && result.disposition === "REVIEW_REQUIRED"
      ? stagedRangeContextIssue(candidates[i], contextIndex) : null;
    const ageOverlapIssue = resolved && result.disposition === "REVIEW_REQUIRED"
      ? stagedRangeAgeOverlapIssue(candidates[i], ageOverlaps) : null;
    return {
      rowNumber: row.rowNumber, rowStatus: row.status,
      candidate: resolved ? candidates[i] : null,
      disposition: row.status === "IMPORTED" || row.status === "SKIPPED" ? "BLOCKED" : result.disposition,
      issues: row.status === "IMPORTED" || row.status === "SKIPPED" ? ["ROW_ALREADY_PROCESSED"] :
        [...result.issues, ...(contextIssue ? [contextIssue] : []),
          ...(ageOverlapIssue ? [ageOverlapIssue] : [])],
      testId: result.testId, componentId: result.componentId, unitId: result.unitId,
    };
  });
  const ctx = await requestContext();
  await prisma.auditEvent.create({
    data: {
      organizationId: scope.organizationId, branchId: scope.branchId,
      actorUserId: session.user.id, action: "CATALOG_CSV_RANGE_RECONCILED",
      entityType: "CatalogImportBatch", entityId: batch.id,
      newValues: { after, reviewed: rows.length,
        stagedContextConflicts: rows.filter(row => row.issues.includes("CONFLICTING_STAGED_RANGE_CONTEXT")).length,
        stagedContextDuplicates: rows.filter(row => row.issues.includes("DUPLICATE_STAGED_RANGE_CONTEXT")).length,
        stagedAgeWindowOverlaps: rows.filter(row => row.issues.includes("POTENTIAL_STAGED_AGE_WINDOW_OVERLAP")).length,
        reviewRequired: rows.filter(row => row.disposition === "REVIEW_REQUIRED").length },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },
  });
  return NextResponse.json({
    batchId: batch.id, rows, nextCursor: staged.length > PAGE_SIZE ? page.at(-1)?.rowNumber ?? null : null,
    hasMore: staged.length > PAGE_SIZE, liveWrites: false,
    approvalRequired: true, clinicalActivation: false,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
