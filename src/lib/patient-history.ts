export type HistoricalResultCandidate = {
  orderItemId: string;
  version: number;
  status: string;
  releasedAt: Date | null;
};

export function latestClinicalResultIds<T extends HistoricalResultCandidate>(results: readonly T[]) {
  const latest = new Map<string, T>();
  for (const result of results) {
    if (!["RELEASED", "AMENDED"].includes(result.status)) continue;
    const current = latest.get(result.orderItemId);
    if (!current || result.version > current.version) latest.set(result.orderItemId, result);
  }
  return new Set([...latest.values()].map(result => result.orderItemId + ":" + result.version));
}

export type CurrentReportEvidence = {
  currentVersion: number;
  versions: readonly {
    version: number;
    status: string;
    resultVersionSnapshot: unknown;
  }[];
};

// A released laboratory result is not necessarily a currently disclosed result:
// the current diagnostic report may be retracted or may supersede that revision.
// Read only exact result revision pointers from the latest non-retracted report.
export function currentReportResultIds(reports: readonly CurrentReportEvidence[]) {
  const ids = new Set<string>();
  for (const report of reports) {
    const current = report.versions.find(version => version.version === report.currentVersion);
    if (!current || !["PARTIAL", "FINAL", "AMENDED"].includes(current.status)) continue;
    if (!Array.isArray(current.resultVersionSnapshot)) continue;
    for (const pointer of current.resultVersionSnapshot) {
      if (!pointer || typeof pointer !== "object") continue;
      if (typeof pointer.resultId !== "string" || !pointer.resultId) continue;
      if (typeof pointer.orderItemId !== "string" || !pointer.orderItemId) continue;
      if (!Number.isSafeInteger(pointer.resultVersion) || pointer.resultVersion < 1) continue;
      ids.add(pointer.resultId);
    }
  }
  return ids;
}

export function patientIdentityGroupIds(canonicalId: string, aliasIds: readonly string[]) {
  return [...new Set([canonicalId, ...aliasIds.filter(id => id !== canonicalId)])];
}

export type TrendPointInput = {
  testId: string;
  testCode: string;
  testNameEn: string;
  testNameAr: string | null;
  componentId: string | null;
  methodId?: string | null;
  analyzerCode?: string | null;
  componentCode: string;
  componentNameEn: string;
  componentNameAr: string | null;
  unit: string | null;
  valueNumeric: string | null;
  displayValue: string;
  flag: string;
  observedAt: string;
  accessionNumber: string;
  orderId: string;
  resultVersion: number;
};

export type TrendSeries = {
  key: string;
  testCode: string;
  testNameEn: string;
  testNameAr: string | null;
  componentCode: string;
  componentNameEn: string;
  componentNameAr: string | null;
  unit: string | null;
  comparable: boolean;
  points: Array<{
    value: number;
    valueText: string;
    flag: string;
    observedAt: string;
    accessionNumber: string;
    orderId: string;
    resultVersion: number;
  }>;
};

export function buildPatientTrendSeries(points: readonly TrendPointInput[]) {
  const groups = new Map<string, TrendSeries>();
  for (const point of points) {
    if (point.valueNumeric === null) continue;
    const numeric = Number(point.valueNumeric);
    if (!Number.isFinite(numeric)) continue;

    // Unit is intentionally part of the series identity. Historical values are never
    // converted or mixed across units because no conversion policy is assumed.
    const componentIdentity = point.componentId || "snapshot:" + point.componentCode;
    const unitIdentity = point.unit === null ? "unitless" : point.unit;
    // Unknown methods cannot be assumed equivalent across orders. Keep their
    // numeric history visible but do not imply a comparable multi-order trend.
    const methodIdentity = point.methodId ? "method:" + point.methodId : "unknown:" + point.orderId;
    const analyzerIdentity = point.analyzerCode || "no-analyzer";
    const key = point.testId + "|" + componentIdentity + "|" + unitIdentity + "|" + methodIdentity + "|" + analyzerIdentity;

    const series = groups.get(key) || {
      key,
      testCode: point.testCode,
      testNameEn: point.testNameEn,
      testNameAr: point.testNameAr,
      componentCode: point.componentCode,
      componentNameEn: point.componentNameEn,
      componentNameAr: point.componentNameAr,
      unit: point.unit,
      comparable: Boolean(point.methodId),
      points: [],
    };
    series.points.push({
      value: numeric,
      valueText: point.displayValue,
      flag: point.flag,
      observedAt: point.observedAt,
      accessionNumber: point.accessionNumber,
      orderId: point.orderId,
      resultVersion: point.resultVersion,
    });
    groups.set(key, series);
  }

  return [...groups.values()]
    .map(series => ({
      ...series,
      points: [...series.points].sort((a, b) => a.observedAt.localeCompare(b.observedAt)),
    }))
    .filter(series => series.points.length > 0)
    .sort((a, b) =>
      a.testCode.localeCompare(b.testCode)
      || a.componentCode.localeCompare(b.componentCode)
      || (a.unit || "").localeCompare(b.unit || "")
    );
}
