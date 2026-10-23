/**
 * Validation ONLY for CSV/XLSX evidence staging. Never change legacy MDB
 * master import eligibility or silently add live catalog activation rights.
 */
export type ExpandedCsvIssue = { severity: "ERROR" | "WARNING"; code: string; message: string };
export function validateExpandedCsvReviewRow(entityType: string, normalized: Record<string, unknown>): ExpandedCsvIssue[] {
  const issues: ExpandedCsvIssue[] = [];
  if (entityType === "PANEL") {
    const members = normalized.memberTestCodes;
    if (typeof normalized.code !== "string" || !/^[A-Z0-9._-]{1,80}$/.test(normalized.code) ||
        typeof normalized.nameEn !== "string" || !normalized.nameEn.trim() ||
        normalized.nameEn.length > 200 ||
        !Array.isArray(members) || members.length === 0 || members.length > 300 ||
        members.some(value => typeof value !== "string" || !/^[A-Z0-9._-]{1,80}$/.test(value)) ||
        new Set(members).size !== members.length) {
      issues.push({ severity: "ERROR", code: "PANEL_MEMBERSHIP_REQUIRED",
        message: "Panel must list distinct approved existing test codes; no membership inference." });
    }
    issues.push({ severity: "WARNING", code: "PANEL_CLINICAL_REVIEW_REQUIRED",
      message: "Review the full panel membership in approved clinical scope before separate activation." });
  }
  if (entityType === "TEST" || entityType === "UNIT" || entityType === "CONTAINER") {
    if (entityType === "UNIT" && (typeof normalized.symbol !== "string" ||
        !normalized.symbol.trim() || normalized.symbol.length > 80)) {
      issues.push({ severity: "ERROR", code: "UNIT_SYMBOL_REQUIRED",
        message: "Unit symbol must be explicitly specified and checked against UCUM." });
    }
    if (entityType === "UNIT" && (typeof normalized.ucumCode !== "string" ||
        normalized.ucumCode.length > 50)) {
      issues.push({ severity: "ERROR", code: "UNIT_UCUM_FIELD_INVALID",
        message: "Explicit UCUM code must fit the stored unit field; no automatic mapping is inferred." });
    }
    if (entityType === "CONTAINER" && (
        typeof normalized.nameAr !== "string" || normalized.nameAr.length > 150 ||
        typeof normalized.tubeColor !== "string" || normalized.tubeColor.length > 80 ||
        typeof normalized.additive !== "string" || normalized.additive.length > 150)) {
      issues.push({ severity: "ERROR", code: "CONTAINER_SOURCE_FIELDS_INVALID",
        message: "Container bilingual name, tube color and additive exceed the source master field limits." });
    }
    issues.push({ severity: "WARNING", code: "MASTER_REVIEW_ONLY",
      message: "Review-only evidence: requires identity, duplicate and owner/clinical verification." });
  }
  return issues;
}
