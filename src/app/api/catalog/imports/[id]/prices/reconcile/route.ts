import { NextResponse } from "next/server";
import { requirePermission, requestContext } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { reconcilePriceCandidate, type PriceCandidate } from "@/lib/price-import-reconciliation";

const PAGE_SIZE = 100;
const asObject = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const field = (data: Record<string, unknown>, key: string) =>
  typeof data[key] === "string" ? (data[key] as string).trim() : "";
const candidateOf = (value: unknown): PriceCandidate => {
  const data = asObject(value);
  return {
    priceListCode: field(data, "priceListCode").toUpperCase(),
    testCode: field(data, "testCode").toUpperCase(),
    unitPrice: field(data, "unitPrice"),
    effectiveFrom: field(data, "effectiveFrom"),
    effectiveTo: field(data, "effectiveTo"),
  };
};
const identity = (candidate: PriceCandidate) =>
  candidate.priceListCode + "|" + candidate.testCode + "|" + candidate.effectiveFrom;

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requirePermission("pricing.manage");
  await requirePermission("catalog.manage");
  const ctx = await requestContext();
  const { id } = await params;
  const raw = new URL(request.url).searchParams.get("after");
  if (raw !== null && (!/^[1-9]\d{0,8}$/.test(raw) || Number(raw) > 100000000))
    return NextResponse.json({ error: "invalid_row_cursor" }, { status: 400 });
  const after = raw === null ? 0 : Number(raw);
  const batch = await prisma.catalogImportBatch.findFirst({
    where: { id, organizationId: session.user.organizationId },
    select: { id: true, status: true },
  });
  if (!batch) return NextResponse.json({ error: "batch_not_found" }, { status: 404 });
  const rows = await prisma.catalogImportRow.findMany({
    where: { batchId: batch.id, entityType: "PRICE_LIST_ITEM", rowNumber: { gt: after } },
    select: { rowNumber: true, normalizedData: true, validationIssues: true, status: true },
    orderBy: [{ rowNumber: "asc" }, { id: "asc" }],
    take: PAGE_SIZE + 1,
  });
  const visible = rows.slice(0, PAGE_SIZE);
  const candidates = visible.map(row => candidateOf(row.normalizedData));
  const listCodes = [...new Set(candidates.map(row => row.priceListCode).filter(Boolean))];
  const testCodes = [...new Set(candidates.map(row => row.testCode).filter(Boolean))];
  const [lists, tests, stagedRows] = await Promise.all([
    prisma.priceList.findMany({
      where: { organizationId: session.user.organizationId, code: { in: listCodes } },
      select: {
        id: true, code: true, currency: true, status: true, effectiveFrom: true, effectiveTo: true,
        items: { select: { testId: true, effectiveFrom: true, effectiveTo: true } },
      },
    }),
    prisma.labTest.findMany({
      where: { organizationId: session.user.organizationId, code: { in: testCodes } },
      select: { id: true, code: true, status: true },
    }),
    prisma.catalogImportRow.findMany({
      where: { batchId: batch.id, entityType: "PRICE_LIST_ITEM" },
      select: { normalizedData: true },
    }),
  ]);
  const listIndex = new Map(lists.map(list => [list.code.toUpperCase(), list]));
  const testIndex = new Map(tests.map(test => [test.code.toUpperCase(), test]));
  const counts = new Map<string, number>();
  for (const row of stagedRows) {
    const key = identity(candidateOf(row.normalizedData));
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const existing = lists.flatMap(list => list.items.map(item => ({
    priceListId: list.id, testId: item.testId,
    effectiveFrom: item.effectiveFrom, effectiveTo: item.effectiveTo,
  })));
  const reconciled = visible.map((row, index) => {
    const candidate = candidates[index];
    const assessment = reconcilePriceCandidate(candidate, {
      lists: listIndex, tests: testIndex, existing,
    }, counts.get(identity(candidate)) || 0);
    const invalid = row.status === "ERROR" || row.status === "IMPORTED" || row.status === "SKIPPED";
    return {
      rowNumber: row.rowNumber, rowStatus: row.status, candidate,
      ...assessment, disposition: invalid ? "BLOCKED" : assessment.disposition,
      issues: [...(invalid ? ["STAGED_ROW_NOT_ELIGIBLE"] : []), ...assessment.issues],
      stagedIssues: Array.isArray(row.validationIssues) ? row.validationIssues : [],
    };
  });
  await prisma.auditEvent.create({ data: {
    organizationId: session.user.organizationId, branchId: session.activeBranchId,
    actorUserId: session.user.id, action: "CATALOG_PRICE_IMPORT_RECONCILED",
    entityType: "CatalogImportBatch", entityId: batch.id,
    newValues: { reviewed: reconciled.length, after,
      readyForGovernance: reconciled.filter(row => row.disposition === "READY_FOR_GOVERNANCE").length },
    ipAddress: ctx.ipAddress, userAgent: ctx.userAgent,
  } });
  return NextResponse.json({
    batchId: batch.id, batchStatus: batch.status, rows: reconciled,
    nextCursor: rows.length > PAGE_SIZE ? visible.at(-1)?.rowNumber ?? null : null,
    hasMore: rows.length > PAGE_SIZE, approvalRequired: true, liveWrites: false,
  }, { headers: { "Cache-Control": "private, no-store" } });
}
