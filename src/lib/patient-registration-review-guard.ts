/** Strictly bind a duplicate-review override to the candidate identities seen. */
export function patientReviewedCandidateIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 10) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item)) return null;
    ids.push(item.toLowerCase());
  }
  return new Set(ids).size === ids.length ? ids : null;
}

export function patientCandidateReviewIsCurrent(
  reviewedIds: readonly string[] | null, currentIds: readonly string[],
): boolean {
  if (!reviewedIds || reviewedIds.length !== currentIds.length) return false;
  const known = new Set(reviewedIds);
  return known.size === reviewedIds.length && currentIds.every(id => known.has(id));
}

/** Refuse silent truncation: review UI only supports up to 10 candidates. */
export const PATIENT_DUPLICATE_REVIEW_MAX_CANDIDATES = 10;
