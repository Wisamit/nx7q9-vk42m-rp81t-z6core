/**
 * Parse exact user-entered clinical rule limits without IEEE-754 Number.
 * The configured scale/precision must match the target Prisma Decimal
 * column; values exceeding either constraint fail closed, never round.
 *
 * Only JSON strings are accepted: JSON numeric literals can already be
 * lossy before validation. Canonical results retain fixed DB scale.
 */
export type ClinicalDecimalFormat = Readonly<{
  precision: number;
  scale: number;
  nonNegative?: boolean;
}>;

export class ClinicalDecimalError extends Error {
  readonly code = "invalid_clinical_decimal_limit";
  constructor() { super("invalid_clinical_decimal_limit"); }
}

/** Returns null only for deliberately omitted optional values. */
export function parseClinicalRuleDecimal(
  value: unknown,
  format: ClinicalDecimalFormat,
): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > 100 ||
      !Number.isInteger(format.precision) ||
      !Number.isInteger(format.scale) ||
      format.precision < 1 || format.scale < 0 ||
      format.precision <= format.scale) {
    throw new ClinicalDecimalError();
  }
  const trimmed = value.trim();
  // Forbid scientific notation, commas, NaN, Infinity, signs other than '-',
  // ambiguous whitespace or rounding of any supplied fractional digits.
  if (!/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(trimmed)) {
    throw new ClinicalDecimalError();
  }
  if (format.nonNegative && trimmed.startsWith("-")) {
    throw new ClinicalDecimalError();
  }
  const negative = trimmed.startsWith("-");
  const digits = negative ? trimmed.slice(1) : trimmed;
  const [integer, fraction = ""] = digits.split(".");
  if (integer.length > format.precision - format.scale ||
      fraction.length > format.scale) {
    throw new ClinicalDecimalError();
  }
  const normalizedNegative = negative && !/^0+$/.test(integer + fraction);
  return (normalizedNegative ? "-" : "") +
    integer + (format.scale ? "." + fraction.padEnd(format.scale, "0") : "");
}
