export type RangeCandidate = { testName: string; unit: string; sex: string; ageFrom: string; ageTo: string; ageUnit: string; low: string; high: string; normalTextEn: string };
export type ScopedRangeTest = {
  id: string; code: string; nameEn: string; status: string;
  defaultUnitId: string | null; components: Array<{ id: string; unitId: string | null; status: string }>;
};
export type ScopedRangeUnit = { id: string; code: string; symbol: string; status: string };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const value = (v: unknown): string => typeof v === "string" ? v.trim() : "";
const normalized = (v: string): string => v.normalize("NFKC").trim().replace(/\s+/g, " ").toUpperCase();

/** Read-only, exact clinical identity checks. No fuzzy aliasing or clinical approvals. */
export function rangeReviewCandidate(v: unknown): RangeCandidate {
  const d = record(v);
  return { testName: value(d.testName), unit: value(d.unit), sex: value(d.sex),
    ageFrom: value(d.ageFrom), ageTo: value(d.ageTo), ageUnit: value(d.ageUnit),
    low: value(d.low), high: value(d.high), normalTextEn: value(d.normalTextEn) };
}
export function reconcileRangeReviewCandidate(candidate: RangeCandidate,
  tests: readonly ScopedRangeTest[], units: readonly ScopedRangeUnit[],
  sourceIssues: readonly string[] = []): { disposition: "BLOCKED" | "REVIEW_REQUIRED"; issues: string[]; testId: string | null; componentId: string | null; unitId: string | null } {
  const fail = (...issues: string[]) => ({
    disposition: "BLOCKED" as const, issues, testId: null, componentId: null, unitId: null,
  });
  if (sourceIssues.length) return fail(...sourceIssues);
  if (!candidate.testName || !candidate.unit) return fail("MISSING_TEST_OR_UNIT");
  const testMatches = tests.filter(t => t.status === "ACTIVE" &&
    (normalized(t.code) === normalized(candidate.testName) || normalized(t.nameEn) === normalized(candidate.testName)));
  if (testMatches.length !== 1) return fail(testMatches.length ? "AMBIGUOUS_SCOPED_TEST" : "TEST_NOT_IN_CLINICAL_SCOPE");
  const test = testMatches[0];
  const unitMatches = units.filter(u => u.status === "ACTIVE" &&
    (normalized(u.code) === normalized(candidate.unit) || normalized(u.symbol) === normalized(candidate.unit)));
  if (unitMatches.length !== 1) return fail(unitMatches.length ? "AMBIGUOUS_UNIT" : "UNIT_NOT_FOUND");
  const unit = unitMatches[0];
  const active = test.components.filter(c => c.status === "ACTIVE");
  if (active.length !== 1) return fail(active.length ? "MULTI_COMPONENT_REVIEW_REQUIRED" : "COMPONENT_NOT_FOUND");
  const component = active[0];
  if (!component.unitId || component.unitId !== unit.id ||
      (test.defaultUnitId && test.defaultUnitId !== unit.id)) return fail("COMPONENT_UNIT_CONFLICT");
  return { disposition: "REVIEW_REQUIRED", issues: ["CLINICAL_APPROVAL_AND_CONTEXT_REQUIRED"],
    testId: test.id, componentId: component.id, unitId: unit.id };
}


export type StagedRangeReviewRow = { normalizedData: unknown; status: string };

const exactDecimal = (input: string): string | null => {
  if (!input) return "";
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(input)) return null;
  const negative = input.startsWith("-") ? "-" : "";
  const unsigned = input.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const intPart = whole.replace(/^0+(?=\d)/, "") || "0";
  const fracPart = fraction.replace(/0+$/, "");
  if (intPart === "0" && !fracPart) return "0";
  return negative + intPart + (fracPart ? "." + fracPart : "");
};

/**
 * Exact staged context conflicts only: this is not clinical age/sex/method
 * overlap assessment. Never infer equivalent test names or convert units.
 */
export function stagedRangeContextIndex(rows: readonly StagedRangeReviewRow[]): Map<string, { count: number; definitions: Set<string> }> {
  const contexts = new Map<string, { count: number; definitions: Set<string> }>();
  for (const row of rows) {
    if (row.status !== "VALID" && row.status !== "WARNING") continue;
    const candidate = rangeReviewCandidate(row.normalizedData);
    const contextKey = stagedRangeContextKey(candidate);
    if (!contextKey) continue;
    const low = exactDecimal(candidate.low), high = exactDecimal(candidate.high);
    if (low === null || high === null) continue;
    const definition = JSON.stringify([low, high, normalized(candidate.normalTextEn)]);
    const current = contexts.get(contextKey) || { count: 0, definitions: new Set<string>() };
    current.count++;
    current.definitions.add(definition);
    contexts.set(contextKey, current);
  }
  return contexts;
}

function stagedRangeContextKey(candidate: RangeCandidate): string | null {
  if (!candidate.testName || !candidate.unit || !candidate.sex) return null;
  const ageFrom = exactDecimal(candidate.ageFrom), ageTo = exactDecimal(candidate.ageTo);
  if (ageFrom === null || ageTo === null) return null;
  if ((ageFrom || ageTo) && !candidate.ageUnit) return null;
  return JSON.stringify([
    normalized(candidate.testName), normalized(candidate.unit), normalized(candidate.sex),
    ageFrom, ageTo, normalized(candidate.ageUnit),
  ]);
}

/** Advisory only; never converts REVIEW_REQUIRED into clinical permission to commit. */
export function stagedRangeContextIssue(
  candidate: RangeCandidate,
  contexts: ReadonlyMap<string, { count: number; definitions: ReadonlySet<string> }>,
): "DUPLICATE_STAGED_RANGE_CONTEXT" | "CONFLICTING_STAGED_RANGE_CONTEXT" | null {
  const key = stagedRangeContextKey(candidate);
  const entry = key ? contexts.get(key) : null;
  if (!entry || entry.count <= 1) return null;
  return entry.definitions.size > 1 ? "CONFLICTING_STAGED_RANGE_CONTEXT" : "DUPLICATE_STAGED_RANGE_CONTEXT";
}
