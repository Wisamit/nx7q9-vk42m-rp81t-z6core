/**
 * Strict signed F2 UTC instant. JavaScript Date.parse accepts e.g. February 30
 * by rolling into March; that would schedule clinical limits or prices on a
 * different day from the independently signed clinical/finance decision.
 *
 * Store and sign only the unmodified millisecond-exact UTC representation.
 * This is calendar integrity, not authorization, clinical approval or a
 * policy for which dates are clinically/financially appropriate.
 */
export function f2ExactUtcInstant(value: unknown): number | null {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return null;
  }
  const instant = Date.parse(value);
  if (!Number.isFinite(instant)) return null;
  try {
    return new Date(instant).toISOString() === value ? instant : null;
  } catch {
    return null;
  }
}
