/**
 * CSV/XLSX DRAFT-only import integrity. This module never authorizes a write
 * to live catalog, results, tariffs, tax configuration, or historic records.
 */
export type CsvReviewCandidate = {
  entityType: string;
  normalized: Record<string, unknown>;
};
export type CsvReviewIntegrityIssue = {
  severity: "ERROR" | "WARNING";
  code: string;
  message: string;
};

function value(row: Record<string, unknown>, name: string): string {
  return typeof row[name] === "string" ? row[name].trim().toUpperCase() : "";
}

/**
 * Accept an explicit UTC calendar day or a complete UTC timestamp only.
 * Date.parse alone normalizes invalid dates (e.g. February 30) and accepts
 * ambiguous local/offset dates, neither of which is safe for tariff review.
 */
export function strictCsvEffectiveInstant(input: unknown): number | null {
  if (typeof input !== "string") return null;
  let canonical: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    canonical = input + "T00:00:00.000Z";
  } else if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(input)) {
    canonical = input.replace(/\.(\d{1,3})Z$/, (_match, digits: string) =>
      "." + digits.padEnd(3, "0") + "Z")
      .replace(/(\d{2}:\d{2}:\d{2})Z$/, "$1.000Z");
  } else {
    return null;
  }
  const parsed = Date.parse(canonical);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString() === canonical ? parsed : null;
}

function tariffType(type: string): boolean {
  return type === "PRICE_LIST_ITEM" || type === "PRICE_LIST_PACKAGE_ITEM";
}

export function csvReviewTariffRowIssues(
  entityType: string,
  normalized: Record<string, unknown>,
): CsvReviewIntegrityIssue[] {
  if (!tariffType(entityType)) return [];
  const issues: CsvReviewIntegrityIssue[] = [];
  // DECIMAL(18,4) can hold no more than fourteen integer digits.
  if (typeof normalized.unitPrice !== "string" ||
      !/^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/.test(normalized.unitPrice)) {
    issues.push({
      severity: "ERROR", code: "CSV_TARIFF_DECIMAL_OUT_OF_RANGE",
      message: "Tariff must be an exact non-negative DECIMAL(18,4) value.",
    });
  }
  const from = strictCsvEffectiveInstant(normalized.effectiveFrom);
  const to = normalized.effectiveTo === "" || normalized.effectiveTo == null
    ? Number.POSITIVE_INFINITY : strictCsvEffectiveInstant(normalized.effectiveTo);
  if (from === null || to === null || to < from) {
    issues.push({
      severity: "ERROR", code: "CSV_TARIFF_EFFECTIVE_WINDOW_INVALID",
      message: "Tariff window needs exact valid UTC dates in chronological order.",
    });
  }
  return issues;
}

function rowIdentity(candidate: CsvReviewCandidate): string | null {
  const type = candidate.entityType;
  const row = candidate.normalized;
  let parts: string[];
  if (["TEST", "UNIT", "CONTAINER", "PANEL", "PACKAGE", "PRICE_LIST"].includes(type)) {
    parts = [value(row, "code")];
  } else if (type === "COMPONENT") {
    parts = [value(row, "testCode"), value(row, "code")];
  } else if (tariffType(type)) {
    parts = [value(row, "priceListCode"),
      value(row, type === "PRICE_LIST_ITEM" ? "testCode" : "packageCode")];
    const start = strictCsvEffectiveInstant(row.effectiveFrom);
    if (start === null) return null;
    parts.push(String(start));
  } else {
    // Reference interval identity involves more than names/ages and needs
    // explicit clinical reconciliation. Never infer a collision here.
    return null;
  }
  return parts.every(Boolean) ? JSON.stringify([type, ...parts]) : null;
}

export function csvReviewBatchConflictIssues(
  rows: readonly CsvReviewCandidate[],
): CsvReviewIntegrityIssue[][] {
  const issues: CsvReviewIntegrityIssue[][] = rows.map(() => []);
  const identities = new Map<string, number>();
  const tariffGroups = new Map<string, Array<{ index: number; start: number; end: number }>>();
  const flagged = new Set<number>();
  const overlap = (index: number) => {
    if (flagged.has(index)) return;
    flagged.add(index);
    issues[index].push({
      severity: "WARNING", code: "CSV_TARIFF_WINDOWS_OVERLAP",
      message: "This draft contains overlapping tariff windows for the same price list and item; qualified financial reconciliation is required.",
    });
  };
  rows.forEach((candidate, index) => {
    const identity = rowIdentity(candidate);
    if (identity) {
      const previous = identities.get(identity);
      if (previous !== undefined) {
        const conflict: CsvReviewIntegrityIssue = {
          severity: "ERROR", code: "CSV_DUPLICATE_STAGED_IDENTITY",
          message: "Two or more draft rows use the same entity identity and effective start.",
        };
        issues[index].push(conflict);
        if (!issues[previous].some(i => i.code === conflict.code)) issues[previous].push(conflict);
      } else {
        identities.set(identity, index);
      }
    }
    if (!tariffType(candidate.entityType)) return;
    const row = candidate.normalized;
    const code = value(row, "priceListCode");
    const itemCode = value(row, candidate.entityType === "PRICE_LIST_ITEM" ? "testCode" : "packageCode");
    const start = strictCsvEffectiveInstant(row.effectiveFrom);
    const end = row.effectiveTo === "" || row.effectiveTo == null
      ? Number.POSITIVE_INFINITY : strictCsvEffectiveInstant(row.effectiveTo);
    if (!code || !itemCode || start === null || end === null || end < start) return;
    const group = JSON.stringify([candidate.entityType, code, itemCode]);
    const groupRows = tariffGroups.get(group) ?? [];
    groupRows.push({ index, start, end });
    tariffGroups.set(group, groupRows);
  });

  for (const candidates of tariffGroups.values()) {
    candidates.sort((a, b) => a.start - b.start || a.index - b.index);
    let current: (typeof candidates)[number] | null = null;
    for (const candidate of candidates) {
      if (current && current.end >= candidate.start) {
        overlap(current.index);
        overlap(candidate.index);
      }
      if (!current || candidate.end > current.end) current = candidate;
    }
  }
  return issues;
}
