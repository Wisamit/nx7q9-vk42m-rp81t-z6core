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

export function patientIdentityGroupIds(canonicalId: string, aliasIds: readonly string[]) {
  return [...new Set([canonicalId, ...aliasIds.filter(id => id !== canonicalId)])];
}

export type TrendPointInput = {
  testId: string;
  testCode: string;
  testNameEn: string;
  testNameAr: string | null;
  componentId: string | null;
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
    const unitIdentity = point.unit || "unitless";
    const key = point.testId + "|" + componentIdentity + "|" + unitIdentity;

    const series = groups.get(key) || {
      key,
      testCode: point.testCode,
      testNameEn: point.testNameEn,
      testNameAr: point.testNameAr,
      componentCode: point.componentCode,
      componentNameEn: point.componentNameEn,
      componentNameAr: point.componentNameAr,
      unit: point.unit,
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
