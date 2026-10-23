/**
 * Unpublished CSV/XLSX review dependency resolution. Staged masters are
 * never promoted to live identities, foreign keys or clinical authority.
 */
export type DraftReferenceCandidate = {
  entityType: string;
  normalized: Record<string, unknown>;
  status: "VALID" | "WARNING" | "ERROR";
};
export type LiveReferenceSnapshot = {
  tests: ReadonlySet<string>;
  units: ReadonlySet<string>;
  packages: ReadonlySet<string>;
  priceLists: ReadonlySet<string>;
};

const masterKinds = {
  TEST: "tests",
  UNIT: "units",
  PACKAGE: "packages",
  PRICE_LIST: "priceLists",
} as const;

type ReferenceKind = keyof LiveReferenceSnapshot;
const normalizedCode = (value: unknown): string =>
  typeof value === "string" ? value.trim().toUpperCase() : "";

/**
 * Compute only unambiguous eligible staged identities. A staged package is
 * eligible as a review-only parent only if EVERY member test is either
 * active/in-scope live or unambiguous and non-error in this same batch.
 * Never infer approvals, unit conversions, tax rules or clinical equivalence.
 */
export function reviewEligibleStagedReferences(
  candidates: readonly DraftReferenceCandidate[],
  live: LiveReferenceSnapshot,
): Record<ReferenceKind, Set<string>> {
  const staged: Record<ReferenceKind, Set<string>> = {
    tests: new Set(), units: new Set(), packages: new Set(), priceLists: new Set(),
  };
  const encountered = new Set<string>();
  const ambiguous = new Set<string>();
  for (const candidate of candidates) {
    if (!(candidate.entityType in masterKinds)) continue;
    const kind = masterKinds[candidate.entityType as keyof typeof masterKinds];
    const code = normalizedCode(candidate.normalized.code);
    if (!code) continue;
    const key = JSON.stringify([kind, code]);
    if (encountered.has(key)) ambiguous.add(key);
    encountered.add(key);
    if (candidate.status !== "ERROR") staged[kind].add(code);
  }
  for (const encoded of ambiguous) {
    const [kind, code] = JSON.parse(encoded) as [ReferenceKind, string];
    staged[kind].delete(code);
  }
  for (const candidate of candidates) {
    if (candidate.entityType !== "PACKAGE") continue;
    const packageCode = normalizedCode(candidate.normalized.code);
    if (!staged.packages.has(packageCode)) continue;
    const members = candidate.normalized.memberTestCodes;
    const eligible = Array.isArray(members) && members.length > 0 &&
      members.every(value => typeof value === "string" && !!normalizedCode(value) &&
        (live.tests.has(normalizedCode(value)) ||
          staged.tests.has(normalizedCode(value))));
    if (!eligible) staged.packages.delete(packageCode);
  }
  return staged;
}
