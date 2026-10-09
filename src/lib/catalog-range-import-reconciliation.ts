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
