import type { ImportInputRow } from "./catalog-import";

export type CsvRangeReviewIssue = { severity: "ERROR" | "WARNING"; code: string; message: string };

/**
 * Review-only validation, separate from legacy MDB clinical migration.
 * Never coerce numbers or infer patient sex, age units, clinical ranges,
 * interval inclusivity, method or branch.
 */
export function validateRangeCsvReview(row: ImportInputRow): CsvRangeReviewIssue[] {
  if (row.entityType !== "REFERENCE_INTERVAL") return [];
  const data = row.data;
  const value = (key: string) => typeof data[key] === "string" ? (data[key] as string).trim() : "";
  const issues: CsvRangeReviewIssue[] = [];
  const error = (code: string, message: string) => issues.push({ severity: "ERROR", code, message });
  const name = value("testName");
  const unit = value("unit");
  const sex = value("sex").toUpperCase() || "ANY";
  const ageUnit = value("ageUnit").toUpperCase();
  const ageFrom = value("ageFrom"), ageTo = value("ageTo");
  const low = value("low"), high = value("high");
  const normal = value("normalTextEn");
  if (!name || name.length > 200) error("RANGE_REVIEW_INVALID_TEST", "Test name is required and must be at most 200 characters.");
  if (!unit || unit.length > 50) error("RANGE_REVIEW_UNIT_REQUIRED", "Explicit unit (max 50 characters) is required for clinical reconciliation.");
  if (!["ANY", "MALE", "FEMALE"].includes(sex)) error("RANGE_REVIEW_INVALID_SEX", "Use ANY, MALE or FEMALE.");
  if (ageUnit && !["DAY", "WEEK", "MONTH", "YEAR"].includes(ageUnit)) {
    error("RANGE_REVIEW_INVALID_AGE_UNIT", "Use DAY, WEEK, MONTH or YEAR.");
  }
  if ((ageFrom || ageTo) && !ageUnit) error("RANGE_REVIEW_AGE_UNIT_REQUIRED", "Age unit is required for any age boundary.");
  if (ageUnit && !ageFrom && !ageTo) error("RANGE_REVIEW_AGE_BOUNDS_REQUIRED", "Age unit without age boundaries is ambiguous.");
  // Decimal(10,3) for age; Decimal(18,6) for numeric interval.
  const agePattern = /^(?:0|[1-9]\d{0,6})(?:\.\d{1,3})?$/;
  const rangePattern = /^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,6})?$/;
  if (ageFrom && !agePattern.test(ageFrom)) error("RANGE_REVIEW_INVALID_AGE_FROM", "Age-from must be non-negative decimal(10,3).");
  if (ageTo && !agePattern.test(ageTo)) error("RANGE_REVIEW_INVALID_AGE_TO", "Age-to must be non-negative decimal(10,3).");
  if (low && !rangePattern.test(low)) error("RANGE_REVIEW_INVALID_LOW", "Low must be a decimal(18,6).");
  if (high && !rangePattern.test(high)) error("RANGE_REVIEW_INVALID_HIGH", "High must be a decimal(18,6).");
  if (normal.length > 500) error("RANGE_REVIEW_NORMAL_TEXT_TOO_LONG", "Normal text exceeds 500 characters.");
  if (!low && !high && !normal) error("RANGE_REVIEW_EMPTY", "Supply numeric lower/upper limit or normal text.");

  const scaled = (v: string, digits: number) => {
    const negative = v.startsWith("-");
    const [whole, fraction = ""] = (negative ? v.slice(1) : v).split(".");
    const unsigned = BigInt(whole) * (BigInt(10) ** BigInt(digits)) +
      BigInt(fraction.padEnd(digits, "0") || "0");
    return negative ? -unsigned : unsigned;
  };
  if (ageFrom && ageTo && agePattern.test(ageFrom) && agePattern.test(ageTo) &&
      scaled(ageFrom, 3) > scaled(ageTo, 3)) {
    error("RANGE_REVIEW_REVERSED_AGE", "Age-from cannot exceed age-to in the same unit.");
  }
  if (low && high && rangePattern.test(low) && rangePattern.test(high) &&
      scaled(low, 6) > scaled(high, 6)) {
    error("RANGE_REVIEW_REVERSED_LIMITS", "Lower limit cannot exceed upper limit.");
  }
  // Even syntactically valid clinical candidates require explicit human review.
  issues.push({ severity: "WARNING", code: "RANGE_REVIEW_CLINICAL_APPROVAL_REQUIRED",
    message: "Staged only. Match component/method/branch, review age/sex limits and obtain clinical approval before activation." });
  return issues;
}
