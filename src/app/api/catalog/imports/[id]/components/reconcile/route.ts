import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "@/lib/catalog-clinical-import-scope";
import { reconcileComponentCandidate } from "@/lib/component-import-reconciliation";
import { blockedComponentReviewRow, componentCsvReviewAllowed, isReviewableComponentStatus } from "@/lib/component-review-disclosure";

const PAGE_SIZE = 100;
const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
const asText = (value: unknown): string =>
  typeof value === "string" ? value.trim() : "";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("catalog.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const scope = resolveClinicalImportScope({
    organizationId: session.user.organizationId,
    activeBranchId: session.activeBranchId,
    activeBranch: session.activeBranch,
    branchScopes: session.user.branchScopes,
    departmentScopes: session.user.departmentScopes,
  });
  if (!scope) return NextResponse.json({ error: "active_clinical_import_scope_required" }, { status: 403 });
  const search = new URL(request.url).searchParams;
  const rawAfter = search.get("after");
  if (rawAfter !== null && (!/^[1-9]\d{0,8}$/.test(rawAfter) || Number(rawAfter) > 100000000)) {
    return NextResponse.json({ error: "invalid_row_cursor" }, { status: 400 });
  }
  const after = rawAfter === null ? 0 : Number(rawAfter);
  const batch = await prisma.catalogImportBatch.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { id: true, status: true, sourceType: true, createdByUserId: true },
  });
  if (!batch || !componentCsvReviewAllowed(batch, session.user.id)) {
    return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  }

  const rows = await prisma.catalogImportRow.findMany({
    where: { batchId: batch.id, entityType: "COMPONENT", rowNumber: { gt: after } },
    select: { id: true, rowNumber: true, status: true, normalizedData: true, validationIssues: true },
    orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
    take: PAGE_SIZE + 1,
  });
  const visible = rows.slice(0, PAGE_SIZE);
  const candidates = visible.map(row => {
    // Do not normalize or resolve already processed and erroneous source rows.
    if (!isReviewableComponentStatus(row.status)) return { row, candidate: null };
    const d = asRecord(row.normalizedData);
    return {
      row, candidate: {
        testCode: asText(d.testCode).toUpperCase(),
        code: asText(d.code).toUpperCase(),
        nameEn: asText(d.nameEn),
        unitCode: asText(d.unitCode).toUpperCase(),
        resultType: asText(d.resultType).toUpperCase(),
      },
    };
  });
  const testCodes = [...new Set(candidates.map(x => x.candidate?.testCode).filter((v): v is string => !!v))];
  const unitCodes = [...new Set(candidates.map(x => x.candidate?.unitCode).filter((v): v is string => !!v))];

  const [tests, units, duplicateRows] = await Promise.all([
    prisma.labTest.findMany({
      where: { ...clinicalImportTestWhere(scope), code: { in: testCodes } },
      select: {
        id: true, code: true, status: true,
        components: { select: { code: true } },
      },
    }),
    prisma.unit.findMany({
      where: { organizationId: session.user.organizationId, code: { in: unitCodes } },
      select: { id: true, code: true, status: true },
    }),
    // Duplicate detection applies to the *whole batch*, not only the
    // current cursor page. Ambiguous identities must never be marked ready.
    prisma.catalogImportRow.findMany({
      where: { batchId: batch.id, entityType: "COMPONENT", status: { in: ["VALID", "WARNING"] } },
      select: { normalizedData: true },
      take: 20001,
    }),
  ]);
  if (duplicateRows.length > 20000) {
    return NextResponse.json({ error: "component_review_row_limit_exceeded" }, { status: 409 });
  }
  const testIndex = new Map(tests.map(t => [t.code.toUpperCase(), { id: t.id, status: t.status }]));
  const unitIndex = new Map(units.map(u => [u.code.toUpperCase(), { id: u.id, status: u.status }]));
  const componentIndex = new Set(tests.flatMap(test =>
    test.components.map(component => test.id + "|" + component.code.toUpperCase())
  ));
  const counts = new Map<string, number>();
  for (const row of duplicateRows) {
    const d = asRecord(row.normalizedData);
    const test = asText(d.testCode).toUpperCase(), component = asText(d.code).toUpperCase();
    if (!test || !component) continue;
    const key = test + "|" + component;
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const reconciled = candidates.map(({ row, candidate }) => {
    if (!candidate) return blockedComponentReviewRow(row);
    const assessment = reconcileComponentCandidate(candidate, {
      tests: testIndex, units: unitIndex, components: componentIndex,
    }, counts.get(candidate.testCode + "|" + candidate.code) || 0);
    // Missing or out-of-department tests must never echo component identities,
    // unmatched test codes, stale validation metadata or resolved unit IDs.
    if (!assessment.resolvedTestId) {
      return blockedComponentReviewRow(row, "PARENT_TEST_NOT_ACTIVE_OR_MISSING");
    }
    return {
      rowNumber: row.rowNumber,
      rowStatus: row.status,
      candidate,
      disposition: assessment.disposition,
      issues: assessment.issues,
      stagedIssues: Array.isArray(row.validationIssues) ? row.validationIssues : [],
      resolvedTestId: assessment.resolvedTestId,
      resolvedUnitId: assessment.resolvedUnitId,
    };
  });

  await prisma.auditEvent.create({
    data: {
      organizationId: session.user.organizationId,
      branchId: session.activeBranchId,
      actorUserId: session.user.id,
      action: "CATALOG_COMPONENT_IMPORT_RECONCILED",
      entityType: "CatalogImportBatch",
      entityId: batch.id,
      newValues: {
        reviewed: reconciled.length, after,
        readyForGovernance: reconciled.filter(row => row.disposition === "READY_FOR_GOVERNANCE").length,
        // No patient, result, price, range, or source file data is logged.
      },
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    },
  });

  return NextResponse.json({
    batchId: batch.id, batchStatus: batch.status, rows: reconciled,
    nextCursor: rows.length > PAGE_SIZE ? visible.at(-1)?.rowNumber ?? null : null,
    hasMore: rows.length > PAGE_SIZE,
    approvalRequired: true,
    liveWrites: false,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
