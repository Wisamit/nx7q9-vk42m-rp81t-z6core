import { currentReportResultPointers } from "./patient-history.ts";

// Derived display-only comparisons: never write or reinterpret released report snapshots.
export type ReportComparisonEvidence = {
  currentVersion: number;
  order: { id: string; patientId: string; accessionNumber: string; orderedAt: Date };
  versions: readonly {
    version: number;
    status: string;
    issuedAt: Date;
    contentSnapshot: unknown;
    resultVersionSnapshot: unknown;
  }[];
};

type FieldRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is FieldRecord =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const nonEmpty = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;
const optionalText = (value: unknown): string | null =>
  typeof value === "string" ? value : null;
const CURRENT_STATUSES = new Set(["PARTIAL", "FINAL", "AMENDED"]);

export type ReportReading = {
  orderId: string;
  accessionNumber: string;
  issuedAt: string;
  testId: string | null;
  testNameEn: string;
  testNameAr: string | null;
  componentId: string | null;
  componentNameEn: string;
  componentNameAr: string | null;
  unit: string | null;
  methodId: string | null;
  analyzerCode: string | null;
  branchId: string;
  value: string;
  flag: string;
  referenceLow: string | null;
  referenceHigh: string | null;
  referenceTextEn: string | null;
  referenceTextAr: string | null;
  resultVersion: number;
};

export type CumulativeComparison = {
  current: ReportReading;
  previous: ReportReading | null;
  reason: "MATCH" | "IDENTITY_UNKNOWN" | "METHOD_UNKNOWN" | "NO_COMPARABLE";
};

export function extractCurrentReportReadings(
  report: ReportComparisonEvidence,
  authorizedPerformingBranches: readonly string[],
): ReportReading[] {
  const version = report.versions.find(item => item.version === report.currentVersion);
  if (!version || !CURRENT_STATUSES.has(version.status)) return [];
  const snapshot = version.contentSnapshot;
  // Corroborate immutable report identity against the DB order, including the
  // historical patient ID (which can be an alias after a legitimate merge).
  if (!isRecord(snapshot) || !isRecord(snapshot.order) || !isRecord(snapshot.patient) ||
      snapshot.order.id !== report.order.id ||
      snapshot.order.accessionNumber !== report.order.accessionNumber ||
      snapshot.patient.id !== report.order.patientId ||
      !Array.isArray(snapshot.results)) return [];

  const pointers = currentReportResultPointers([{
    orderId: report.order.id,
    currentVersion: report.currentVersion,
    versions: report.versions,
  }]);
  const resultCounts = new Map<string, number>();
  for (const raw of snapshot.results) {
    if (!isRecord(raw) || !nonEmpty(raw.resultId)) continue;
    const id = raw.resultId as string;
    resultCounts.set(id, (resultCounts.get(id) || 0) + 1);
  }

  const visibleBranches = new Set(authorizedPerformingBranches);
  const rows: ReportReading[] = [];
  for (const result of snapshot.results) {
    if (!isRecord(result) || !isRecord(result.performingBranch)) continue;
    const branchId = nonEmpty(result.performingBranch.id);
    if (!branchId || !visibleBranches.has(branchId)) continue;
    const resultId = nonEmpty(result.resultId);
    const orderItemId = nonEmpty(result.orderItemId);
    const resultVersion = result.resultVersion;
    if (!resultId || !orderItemId || !Number.isSafeInteger(resultVersion) ||
        Number(resultVersion) < 1 || resultCounts.get(resultId) !== 1) continue;
    const attested = pointers.get(resultId);
    if (!attested || attested.orderId !== report.order.id ||
        attested.orderItemId !== orderItemId || attested.resultVersion !== resultVersion) continue;
    if (!Array.isArray(result.values)) continue;
    const codes = new Set<string>();
    let validComponents = true;
    for (const value of result.values) {
      const code = isRecord(value) ? nonEmpty(value.componentCode) : null;
      if (!code || codes.has(code)) {
        validComponents = false;
        break;
      }
      codes.add(code);
    }
    if (!validComponents) continue;

    for (const value of result.values) {
      if (!isRecord(value) || typeof value.displayValue !== "string") continue;
      if (value.displayValue === "") continue;
      rows.push({
        orderId: report.order.id,
        accessionNumber: report.order.accessionNumber,
        issuedAt: version.issuedAt.toISOString(),
        testId: nonEmpty(result.testId),
        testNameEn: nonEmpty(result.testNameEn) || nonEmpty(result.testCode) || "",
        testNameAr: optionalText(result.testNameAr),
        componentId: nonEmpty(value.componentId),
        componentNameEn: nonEmpty(value.componentNameEn) || nonEmpty(value.componentCode) || "",
        componentNameAr: optionalText(value.componentNameAr),
        unit: optionalText(value.unit),
        methodId: nonEmpty(result.methodId),
        analyzerCode: isRecord(result.analyzer) ? nonEmpty(result.analyzer.code) : null,
        branchId,
        value: value.displayValue,
        flag: nonEmpty(value.flag) || "UNKNOWN",
        referenceLow: optionalText(value.referenceLow),
        referenceHigh: optionalText(value.referenceHigh),
        referenceTextEn: optionalText(value.referenceTextEn),
        referenceTextAr: optionalText(value.referenceTextAr),
        resultVersion: Number(resultVersion),
      });
    }
  }
  return rows;
}

function clinicalIdentity(reading: ReportReading): string | null {
  if (!reading.testId || !reading.componentId || !reading.methodId) return null;
  return [
    reading.testId,
    reading.componentId,
    reading.unit === null ? "unit:absent" : "unit:" + reading.unit,
    reading.methodId,
    reading.analyzerCode === null ? "analyzer:absent" : "analyzer:" + reading.analyzerCode,
  ].join("|");
}

export function compareCurrentReportWithPrevious(
  current: ReportComparisonEvidence,
  previousReports: readonly ReportComparisonEvidence[],
  authorizedBranches: readonly string[],
): CumulativeComparison[] {
  const currentVersion = current.versions.find(version => version.version === current.currentVersion);
  const currentReadings = extractCurrentReportReadings(current, authorizedBranches);
  if (!currentVersion || !CURRENT_STATUSES.has(currentVersion.status)) return [];
  const previousByIdentity = new Map<string, ReportReading>();
  for (const candidate of previousReports) {
    // A previous *order* can have a delayed report. Compare only reports
    // already issued before the current report, never future revisions.
    if (candidate.order.orderedAt.getTime() >= current.order.orderedAt.getTime()) continue;
    for (const reading of extractCurrentReportReadings(candidate, authorizedBranches)) {
      const id = clinicalIdentity(reading);
      if (!id || reading.issuedAt >= currentVersion.issuedAt.toISOString()) continue;
      const existing = previousByIdentity.get(id);
      if (!existing || reading.issuedAt > existing.issuedAt) previousByIdentity.set(id, reading);
    }
  }
  return currentReadings.map(reading => {
    const reason = !reading.testId || !reading.componentId
      ? "IDENTITY_UNKNOWN"
      : !reading.methodId
        ? "METHOD_UNKNOWN"
        : "NO_COMPARABLE";
    const previous = clinicalIdentity(reading)
      ? previousByIdentity.get(clinicalIdentity(reading)!) || null
      : null;
    return { current: reading, previous, reason: previous ? "MATCH" : reason };
  });
}
