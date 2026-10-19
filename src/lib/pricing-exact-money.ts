import { validPriceDecimal } from "./price-import-reconciliation.ts";

/**
 * Exact DECIMAL(18,4) admission for *live* test and package price revisions.
 *
 * JSON numbers have already passed through IEEE-754 and cannot be trusted for
 * financial values. Only exact decimal strings are accepted. Align live
 * tariffs with the already-governed legacy price import's precision policy.
 *
 * No rounding, exponential notation, locale-dependent separators, signs,
 * leading zeros or silent truncation. Zero is allowed (existing price rule).
 */
export function normalizeLiveTariffPrice(value: unknown): string | null {
  if (typeof value !== "string" || !validPriceDecimal(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return whole + "." + fraction.padEnd(4, "0");
}
