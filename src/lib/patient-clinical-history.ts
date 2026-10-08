export type ReleasedResultLike = {
  id: string;
  orderItemId: string;
  version: number;
  status: "RELEASED" | "AMENDED";
  releasedAt: Date | null;
};

export type TrendValueLike = {
  testCode: string;
  testNameEn: string;
  testNameAr: string | null;
  componentCode: string;
  componentNameEn: string;
  componentNameAr: string | null;
  unitSnapshot: string | null;
  valueNumeric: number | string;
  releasedAt: Date;
  accessionNumber: string;
  resultId: string;
  flag: string;
};

export type ClinicalTrendSeries = {
  key: string;
  testCode: string;
  testNameEn: string;
  testNameAr: string | null;
  componentCode: string;
  componentNameEn: string;
  componentNameAr: string | null;
  unitSnapshot: string | null;
  points: Array<{
    value: number;
    releasedAt: Date;
    accessionNumber: string;
    resultId: string;
    flag: string;
  }>;
};

export function selectCurrentReleasedResults<T extends ReleasedResultLike>(results: T[]) {
  const byOrderItem = new Map<string, T>();

  for (const result of results) {
    const current = byOrderItem.get(result.orderItemId);
    if (!current || result.version > current.version) {
      byOrderItem.set(result.orderItemId, result);
      continue;
    }
    if (result.version === current.version) {
      const currentTime = current.releasedAt?.getTime() ?? 0;
      const nextTime = result.releasedAt?.getTime() ?? 0;
      if (nextTime > currentTime) byOrderItem.set(result.orderItemId, result);
    }
  }

  return [...byOrderItem.values()];
}

export function clinicalTrendSeriesKey(input: {
  testCode: string;
  componentCode: string;
  unitSnapshot: string | null;
}) {
  return [input.testCode, input.componentCode, input.unitSnapshot || ""].join("::");
}

export function buildClinicalTrendSeries(values: TrendValueLike[]): ClinicalTrendSeries[] {
  const series = new Map<string, ClinicalTrendSeries>();

  for (const item of values) {
    const numeric = typeof item.valueNumeric === "number" ? item.valueNumeric : Number(item.valueNumeric);
    if (!Number.isFinite(numeric)) continue;

    const key = clinicalTrendSeriesKey(item);
    const current = series.get(key) || {
      key,
      testCode: item.testCode,
      testNameEn: item.testNameEn,
      testNameAr: item.testNameAr,
      componentCode: item.componentCode,
      componentNameEn: item.componentNameEn,
      componentNameAr: item.componentNameAr,
      unitSnapshot: item.unitSnapshot,
      points: [],
    };

    current.points.push({
      value: numeric,
      releasedAt: item.releasedAt,
      accessionNumber: item.accessionNumber,
      resultId: item.resultId,
      flag: item.flag,
    });
    series.set(key, current);
  }

  return [...series.values()]
    .map(item => ({
      ...item,
      points: item.points.sort((a, b) => a.releasedAt.getTime() - b.releasedAt.getTime()),
    }))
    .filter(item => item.points.length >= 2)
    .sort((a, b) =>
      b.points.length - a.points.length
      || a.testCode.localeCompare(b.testCode)
      || a.componentCode.localeCompare(b.componentCode)
    );
}

export function trendPolylinePoints(values: number[], width = 320, height = 90, padding = 8) {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min;
  const usableWidth = Math.max(1, width - padding * 2);
  const usableHeight = Math.max(1, height - padding * 2);

  return values.map((value, index) => {
    const x = padding + (usableWidth * index) / (values.length - 1);
    const ratio = range === 0 ? 0.5 : (value - min) / range;
    const y = padding + usableHeight * (1 - ratio);
    return x.toFixed(2) + "," + y.toFixed(2);
  }).join(" ");
}
