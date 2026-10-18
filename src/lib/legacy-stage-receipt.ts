/**
 * A successful HTTP response alone does not establish that a legacy catalog
 * staging batch has the intended row count or a usable review identifier.
 * This is client presentation validation, not a replacement for server auth.
 */
export type LegacyStageReceipt = {
  id: string;
  status: "DRAFT" | "VALIDATED";
  total: number;
  valid: number;
  warning: number;
  error: number;
};

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
}

export function validateLegacyStageReceipt(value: unknown, expectedRows: number): LegacyStageReceipt | null {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      count(expectedRows) === null || expectedRows < 1 || expectedRows > 20_000) return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(obj.id) ||
      (obj.status !== "DRAFT" && obj.status !== "VALIDATED") ||
      !obj.summary || typeof obj.summary !== "object" || Array.isArray(obj.summary)) return null;
  const summary = obj.summary as Record<string, unknown>;
  const total = count(summary.total);
  const valid = count(summary.VALID ?? 0);
  const warning = count(summary.WARNING ?? 0);
  const error = count(summary.ERROR ?? 0);
  if (total !== expectedRows || valid === null || warning === null || error === null ||
      valid + warning + error !== expectedRows ||
      (error > 0 && obj.status !== "DRAFT") ||
      (error === 0 && obj.status !== "VALIDATED")) return null;
  return { id: obj.id, status: obj.status, total: expectedRows, valid, warning, error };
}
