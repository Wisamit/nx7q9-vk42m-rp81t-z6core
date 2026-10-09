export type PriceCandidate = {
  priceListCode: string; testCode: string; unitPrice: string;
  effectiveFrom: string; effectiveTo: string;
};
export type PriceContext = {
  lists: Map<string, { id: string; currency: string; status: string; effectiveFrom: Date; effectiveTo: Date | null }>;
  tests: Map<string, { id: string; status: string }>;
  existing: Array<{ priceListId: string; testId: string; effectiveFrom: Date; effectiveTo: Date | null }>;
};
const dateOnly = /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/;
export function parseImportDate(value: string): Date | null {
  if (!dateOnly.test(value)) return null;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}
export function reconcilePriceCandidate(candidate: PriceCandidate, context: PriceContext, duplicates: number) {
  const issues: string[] = [];
  const list = context.lists.get(candidate.priceListCode);
  const test = context.tests.get(candidate.testCode);
  if (!list || list.status !== "ACTIVE") issues.push("PRICE_LIST_NOT_ACTIVE_OR_MISSING");
  if (!test || test.status !== "ACTIVE") issues.push("TEST_NOT_ACTIVE_OR_MISSING");
  // Prisma DECIMAL(18,4): 14 integral digits maximum, zero or positive.
  if (!/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(candidate.unitPrice)) issues.push("INVALID_DECIMAL_PRICE");
  const from = parseImportDate(candidate.effectiveFrom);
  const to = candidate.effectiveTo ? parseImportDate(candidate.effectiveTo) : null;
  if (!from || (candidate.effectiveTo && !to) || (from && to && to < from)) issues.push("INVALID_EFFECTIVE_WINDOW");
  if (duplicates !== 1) issues.push("DUPLICATE_STAGED_PRICE_IDENTITY");
  if (list && from && (from < list.effectiveFrom || (list.effectiveTo && from > list.effectiveTo)
      || (to && list.effectiveTo && to > list.effectiveTo))) issues.push("OUTSIDE_PRICE_LIST_WINDOW");
  if (list && test && from) {
    const until = to?.getTime() ?? Number.POSITIVE_INFINITY;
    if (context.existing.some(item => item.priceListId === list.id && item.testId === test.id &&
        item.effectiveFrom.getTime() <= until &&
        (item.effectiveTo?.getTime() ?? Number.POSITIVE_INFINITY) >= from.getTime())) {
      issues.push("EXISTING_PRICE_WINDOW_OVERLAP");
    }
  }
  return { disposition: issues.length ? "BLOCKED" as const : "READY_FOR_GOVERNANCE" as const,
    issues, resolvedPriceListId: list?.id ?? null, resolvedTestId: test?.id ?? null, currency: list?.currency ?? null };
}
