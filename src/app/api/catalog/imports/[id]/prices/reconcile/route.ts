import { NextResponse } from "next/server";
import { permissionSet, requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  overlaps, reconcilePriceCandidate, type PriceCandidate,
} from "@/lib/price-import-reconciliation";

const PAGE_SIZE = 100;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";
const normalized = (value: unknown): PriceCandidate => {
  const d = record(value);
  return {
    priceListCode: text(d.priceListCode).toUpperCase(),
    testCode: text(d.testCode).toUpperCase(),
    unitPrice: text(d.unitPrice),
    effectiveFrom: text(d.effectiveFrom),
    effectiveTo: text(d.effectiveTo),
  };
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("pricing.manage");
  if (!permissionSet(session).has("catalog.manage")) {
    return NextResponse.json({ error: "catalog_permission_required" }, { status: 403 });
  }
  const { id } = await params;
  const raw = new URL(request.url).searchParams.get("after");
  if (raw !== null && (!/^[1-9][0-9]{0,8}$/.test(raw) || Number(raw) > 100000000)) {
    return NextResponse.json({ error: "invalid_row_cursor" }, { status: 400 });
  }
  const after = raw === null ? 0 : Number(raw);
  const organizationId = session.user.organizationId;
  const branches = session.user.branchScopes.filter(s => s.branch.status === "ACTIVE").map(s => s.branchId);
  if (!branches.length) return NextResponse.json({ error: "active_branch_scope_required" }, { status: 403 });
  const departments = session.user.departmentScopes.filter(s => s.department.status === "ACTIVE").map(s => s.departmentId);
  const batch = await prisma.catalogImportBatch.findFirst({
    where: { id, organizationId }, select: { id: true, status: true },
  });
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });

  const rows = await prisma.catalogImportRow.findMany({
    where: { batchId: batch.id, entityType: "PRICE_LIST_ITEM", rowNumber: { gt: after } },
    select: { rowNumber: true, status: true, normalizedData: true, validationIssues: true },
    orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
    take: PAGE_SIZE + 1,
  });
  const visible = rows.slice(0, PAGE_SIZE);
  const candidates = visible.map(row => ({ row, candidate: normalized(row.normalizedData) }));
  const listCodes = [...new Set(candidates.map(x => x.candidate.priceListCode).filter(Boolean))];
  const testCodes = [...new Set(candidates.map(x => x.candidate.testCode).filter(Boolean))];
  const [lists, tests, staged] = await Promise.all([
    prisma.priceList.findMany({
      where: {
        organizationId, code: { in: listCodes },
        OR: [{ branchId: null }, { branchId: { in: branches } }],
      },
      select: {
        id: true, code: true, status: true, currency: true,
        effectiveFrom: true, effectiveTo: true,
      },
    }),
    prisma.labTest.findMany({
      where: { organizationId, code: { in: testCodes },
        ...(departments.length ? { departmentId: { in: departments } } : {}) },
      select: { id: true, code: true, status: true },
    }),
    // Import API caps each batch at 20,000 rows. Review all staged windows
    // so a collision on a later page cannot pass as ready on this page.
    prisma.catalogImportRow.findMany({
      where: { batchId: batch.id, entityType: "PRICE_LIST_ITEM" },
      select: { normalizedData: true },
    }),
  ]);
  const listIndex = new Map(lists.map(l => [l.code.toUpperCase(), {
    id: l.id, status: l.status, currency: l.currency,
    effectiveFrom: l.effectiveFrom.toISOString(), effectiveTo: l.effectiveTo?.toISOString() ?? null,
  }]));
  const testIndex = new Map(tests.map(t => [t.code.toUpperCase(), { id: t.id, status: t.status }]));
  const matching = candidates.map(({ candidate }) => ({
    list: listIndex.get(candidate.priceListCode), test: testIndex.get(candidate.testCode),
  }));
  const listIds = [...new Set(matching.map(x => x.list?.id).filter((v): v is string => !!v))];
  const testIds = [...new Set(matching.map(x => x.test?.id).filter((v): v is string => !!v))];
  const existingRows = listIds.length && testIds.length ? await prisma.priceListItem.findMany({
    where: { priceListId: { in: listIds }, testId: { in: testIds } },
    select: { priceListId: true, testId: true, effectiveFrom: true, effectiveTo: true },
  }) : [];
  const existing = new Map<string, Array<{ effectiveFrom: string; effectiveTo: string | null }>>();
  for (const item of existingRows) {
    const key = item.priceListId + "|" + item.testId;
    const values = existing.get(key) ?? [];
    values.push({ effectiveFrom: item.effectiveFrom.toISOString(), effectiveTo: item.effectiveTo?.toISOString() ?? null });
    existing.set(key, values);
  }
  const stagedWindows = new Map<string, PriceCandidate[]>();
  for (const row of staged) {
    const candidate = normalized(row.normalizedData);
    if (!candidate.priceListCode || !candidate.testCode) continue;
    const key = candidate.priceListCode + "|" + candidate.testCode;
    const list = stagedWindows.get(key) ?? [];
    list.push(candidate);
    stagedWindows.set(key, list);
  }

  const resolved = candidates.map(({ row, candidate }) => {
    const key = candidate.priceListCode + "|" + candidate.testCode;
    const overlapCount = (stagedWindows.get(key) ?? []).filter(other =>
      overlaps(candidate.effectiveFrom, candidate.effectiveTo || null,
        other.effectiveFrom, other.effectiveTo || null)).length;
    const result = reconcilePriceCandidate(candidate, {
      lists: listIndex, tests: testIndex, existing,
    }, overlapCount);
    const alreadyProcessed = row.status === "IMPORTED" || row.status === "SKIPPED";
    const disposition = row.status === "ERROR" || alreadyProcessed ? "BLOCKED" : result.disposition;
    return {
      rowNumber: row.rowNumber, rowStatus: row.status, candidate,
      disposition,
      issues: [
        ...(row.status === "ERROR" ? ["STAGED_ROW_HAS_ERRORS"] : []),
        ...(alreadyProcessed ? ["ROW_ALREADY_PROCESSED"] : []),
        ...result.issues,
      ],
      stagedIssues: row.validationIssues, currency: result.currency,
      resolvedPriceListId: result.resolvedPriceListId, resolvedTestId: result.resolvedTestId,
    };
  });
  const ctx = await requestContext();
  await prisma.auditEvent.create({
    data: {
      organizationId, branchId: session.activeBranchId,
      actorUserId: session.user.id, action: "PRICE_IMPORT_RECONCILED",
      entityType: "CatalogImportBatch", entityId: batch.id,
      newValues: {
        reviewed: resolved.length, after,
        readyForGovernance: resolved.filter(x => x.disposition === "READY_FOR_GOVERNANCE").length,
        branchScoped: true, departmentScoped: departments.length > 0,
      },
      ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
    },
  });
  return NextResponse.json({
    batchId: batch.id, batchStatus: batch.status, rows: resolved,
    nextCursor: rows.length > PAGE_SIZE ? visible.at(-1)?.rowNumber ?? null : null,
    hasMore: rows.length > PAGE_SIZE,
    approvalRequired: true, liveWrites: false, currencyConversion: false,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
