export type ReferenceImportPreviewCounts = {
  total: number;
  safe: number;
  review: number;
  generatedTestsRemaining?: number;
};

/**
 * Client-side stale-preview guard, NOT a database transaction or substitute
 * for server-side authorization. Invalid/malformed counts always fail closed.
 */
export function compareReferenceImportPreview(
  expected: ReferenceImportPreviewCounts | null,
  live: ReferenceImportPreviewCounts | null,
): "invalid" | "changed" | "same" {
  const values = (input: ReferenceImportPreviewCounts | null) => {
    if (!input || typeof input !== "object") return null;
    const numbers = [input.total, input.safe, input.review, input.generatedTestsRemaining ?? 0];
    if (!numbers.every(value => Number.isSafeInteger(value) && value >= 0)) return null;
    if (input.safe + input.review > input.total) return null;
    return numbers;
  };
  const before = values(expected), after = values(live);
  if (!before || !after) return "invalid";
  return before.some((value, index) => value !== after[index]) ? "changed" : "same";
}
