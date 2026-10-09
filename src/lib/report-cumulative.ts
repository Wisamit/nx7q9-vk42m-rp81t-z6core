// Derived display-only comparisons: never write or reinterpret released report snapshots.
export type ReportComparisonEvidence = {
  currentVersion: number;
  order: { id: string; accessionNumber: string; orderedAt: Date };
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
  if (!isRecord(version.contentSnapshot) || !Array.isArray(version.contentSnapshot.results)) return [];
  if (!Array.isArray(version.resultVersionSnapshot)) return [];

  const resultPointers = new Set<string>();
  for (const pointer of version.resultVersionSnapshot) {
    if (!isRecord(pointer)) continue;
    const resultId = nonEmpty(pointer.resultId);
    const orderItemId = nonEmpty(pointer.orderItemId);
    if (resultId && orderItemId && Number.isSafeInteger(pointer.resultVersion) && Number(pointer.resultVersion) > 0) {
      resultPointers.add([orderItemId, resultId, pointer.resultVersion].join("|"));
    }
  }

  const visibleBranches = new Set(authorizedPerformingBranches);
  const rows: ReportReading[] = [];
  for (const result of version.contentSnapshot.results) {
    if (!isRecord(result) || !isRecord(result.performingBranch)) continue;
    const branchId = nonEmpty(result.performingBranch.id);
    if (!branchId || !visibleBranches.has(branchId)) continue;
    const resultId = nonEmpty(result.resultId);
    const orderItemId = nonEmpty(result.orderItemId);
    const resultVersion = result.resultVersion;
    if (!resultId || !orderItemId || !Number.isSafeInteger(resultVersion)) continue;
    if (!resultPointers.has([orderItemId, resultId, resultVersion].join("|"))) continue;
    if (!Array.isArray(result.values)) continue;

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
  const currentReadings = extractCurrentReportReadings(current, authorizedBranches);
  const previousByIdentity = new Map<string, ReportReading>();
  for (const candidate of previousReports) {
    // A previous *order* can have a delayed report. Compare only reports
    // already issued before the current report, never future revisions.
    if (candidate.order.orderedAt.getTime() >= current.order.orderedAt.getTime()) continue;
    for (const reading of extractCurrentReportReadings(candidate, authorizedBranches)) {
      const id = clinicalIdentity(reading);
      if (!id || reading.issuedAt >= current.versions[0]?.issuedAt.toISOString()) continue;
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
