export type PriceCandidate = {
  priceListCode: string;
  testCode: string;
  unitPrice: string;
  effectiveFrom: string;
  effectiveTo: string;
};

export type PriceMasterIndex = {
  lists: ReadonlyMap<string, {
    id: string; status: string; currency: string;
    effectiveFrom: string; effectiveTo: string | null;
  }>;
  tests: ReadonlyMap<string, { id: string; status: string }>;
  existing: ReadonlyMap<string, ReadonlyArray<{ effectiveFrom: string; effectiveTo: string | null }>>;
};

export type PriceReconciliation = {
  disposition: "READY_FOR_GOVERNANCE" | "BLOCKED";
  issues: string[];
  resolvedPriceListId: string | null;
  resolvedTestId: string | null;
  currency: string | null;
};

// Price amounts are deliberately validated as strings, never binary floats.
export function validPriceDecimal(value: string): boolean {
  return /^(?:0|[1-9][0-9]{0,13})(?:\.[0-9]{1,4})?$/.test(value);
}

// Accept an explicit calendar day or UTC instant; never infer an offset.
export function calendarInstant(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(value)) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp).toISOString();
  if (date.slice(0, 10) !== value.slice(0, 10)) return null;
  return timestamp;
}

export function overlaps(
  aFrom: string, aTo: string | null,
  bFrom: string, bTo: string | null,
): boolean {
  const fromA = calendarInstant(aFrom), fromB = calendarInstant(bFrom);
  const toA = aTo ? calendarInstant(aTo) : null;
  const toB = bTo ? calendarInstant(bTo) : null;
  if (fromA === null || fromB === null || (aTo && toA === null) || (bTo && toB === null)) return true;
  return (toA === null || fromB <= toA) && (toB === null || fromA <= toB);
}

export function reconcilePriceCandidate(
  candidate: PriceCandidate,
  masters: PriceMasterIndex,
  batchOverlapCount: number,
): PriceReconciliation {
  const issues: string[] = [];
  const list = masters.lists.get(candidate.priceListCode.trim().toUpperCase());
  const test = masters.tests.get(candidate.testCode.trim().toUpperCase());
  const from = calendarInstant(candidate.effectiveFrom);
  const to = candidate.effectiveTo ? calendarInstant(candidate.effectiveTo) : null;

  if (!candidate.priceListCode.trim() || !candidate.testCode.trim()) issues.push("MISSING_PRICE_MAPPING");
  if (!list || list.status !== "ACTIVE") issues.push("PRICE_LIST_NOT_ACTIVE_OR_AUTHORIZED");
  if (!test || test.status !== "ACTIVE") issues.push("TEST_NOT_ACTIVE_OR_AUTHORIZED");
  if (!validPriceDecimal(candidate.unitPrice)) issues.push("INVALID_EXACT_PRICE");
  if (from === null || (candidate.effectiveTo && to === null) || (from !== null && to !== null && to < from)) {
    issues.push("INVALID_EFFECTIVE_WINDOW");
  }
  if (list && !/^[A-Z]{3}$/.test(list.currency)) issues.push("PRICE_LIST_CURRENCY_INVALID");
  if (list && from !== null && (candidate.effectiveTo === "" || to !== null)
    && (from < (calendarInstant(list.effectiveFrom) ?? Number.POSITIVE_INFINITY)
      || (list.effectiveTo && (to ?? Number.POSITIVE_INFINITY) > (calendarInstant(list.effectiveTo) ?? Number.NEGATIVE_INFINITY)))) {
    issues.push("OUTSIDE_PRICE_LIST_EFFECTIVE_WINDOW");
  }

  if (list && test && from !== null) {
    const key = list.id + "|" + test.id;
    if ((masters.existing.get(key) ?? []).some(window =>
      overlaps(candidate.effectiveFrom, candidate.effectiveTo || null, window.effectiveFrom, window.effectiveTo))) {
      issues.push("EXISTING_PRICE_WINDOW_COLLISION");
    }
  }
  if (batchOverlapCount > 1) issues.push("OVERLAPPING_STAGED_PRICE_WINDOWS");
  return {
    disposition: issues.length ? "BLOCKED" : "READY_FOR_GOVERNANCE",
    issues,
    resolvedPriceListId: list?.id ?? null,
    resolvedTestId: test?.id ?? null,
    currency: list?.currency ?? null,
  };
}


export type StagedPriceWindowRow = {
  rowNumber: number;
  status: string;
  normalizedData: unknown;
};

/**
 * Advisory price-window collisions across an entire bounded import batch.
 * Only reviewable staged rows participate. Sorting unique row identities
 * avoids quadratic page-by-page comparisons and never changes live prices.
 * A shared end/start instant is conservatively treated as a collision.
 */
export function stagedPriceOverlapIndex(rows: readonly StagedPriceWindowRow[]): ReadonlySet<number> {
  type Window = { rowNumber: number; start: number; end: number };
  const groups = new Map<string, Window[]>();
  for (const row of rows) {
    if (row.status !== "VALID" && row.status !== "WARNING") continue;
    if (!Number.isSafeInteger(row.rowNumber) || row.rowNumber < 1) continue;
    if (!row.normalizedData || typeof row.normalizedData !== "object" ||
      Array.isArray(row.normalizedData)) continue;
    const data = row.normalizedData as Record<string, unknown>;
    const source = (key: string) => typeof data[key] === "string" ? (data[key] as string).trim() : "";
    const listCode = source("priceListCode").toUpperCase();
    const testCode = source("testCode").toUpperCase();
    if (!listCode || !testCode) continue;
    const from = source("effectiveFrom"), to = source("effectiveTo");
    const start = calendarInstant(from), end = to ? calendarInstant(to) : null;
    if (start === null || (to && end === null) || (end !== null && end < start)) continue;
    const key = JSON.stringify([listCode, testCode]);
    const group = groups.get(key) ?? [];
    group.push({ rowNumber: row.rowNumber, start, end: end ?? Number.POSITIVE_INFINITY });
    groups.set(key, group);
  }

  const collisions = new Set<number>();
  for (const group of groups.values()) {
    group.sort((a, b) => a.start - b.start || a.end - b.end || a.rowNumber - b.rowNumber);
    let greatestPreviousEnd = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < group.length; i++) {
      const current = group[i];
      const overlapsPrior = greatestPreviousEnd >= current.start;
      const overlapsNext = i + 1 < group.length && group[i + 1].start <= current.end;
      if (overlapsPrior || overlapsNext) collisions.add(current.rowNumber);
      if (current.end > greatestPreviousEnd) greatestPreviousEnd = current.end;
    }
  }
  return collisions;
}
