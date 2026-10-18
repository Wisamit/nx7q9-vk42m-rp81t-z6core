/**
 * A draft review upload is confirmed only by a coherent server receipt.
 * This never proves imported data correctness or clinical/financial approval.
 */
export type ReviewStageReceipt = {
  id: string;
  total: number;
  valid: number;
  warning: number;
  error: number;
};

function readCount(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

export function validateReviewStageReceipt(
  value: unknown, kind: "CSV" | "BUNDLE",
): ReviewStageReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (typeof body.id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(body.id) ||
      body.status !== "DRAFT" || body.reviewOnly !== true ||
      !body.summary || typeof body.summary !== "object" || Array.isArray(body.summary)) return null;
  const summary = body.summary as Record<string, unknown>;
  const total = readCount(summary.total);
  // Absent categories are zero in the original API; explicitly present
  // null, NaN, fractional, negative or string counts are never accepted.
  const valid = readCount(summary.VALID === undefined ? 0 : summary.VALID);
  const warning = readCount(summary.WARNING === undefined ? 0 : summary.WARNING);
  const error = readCount(summary.ERROR === undefined ? 0 : summary.ERROR);
  const max = kind === "CSV" ? 20_000 : 5_000;
  if (total === null || total < 1 || total > max ||
      valid === null || warning === null || error === null ||
      valid + warning + error !== total ||
      (kind === "BUNDLE" && (valid !== 0 || error !== 0 || warning !== total))) return null;
  return { id: body.id, total, valid, warning, error };
}
