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


export type ReportResultPointer = {
  orderId: string;
  orderItemId: string;
  resultVersion: number;
};

export type OrderedCurrentReportEvidence = CurrentReportEvidence & {
  orderId: string;
};

/**
 * A current report must explicitly attest the exact result revision,
 * order item and issuing order. Result IDs alone are insufficient evidence
 * for longitudinal clinical disclosure: a report snapshot might be stale,
 * malformed or reference a different order within the same patient.
 *
 * Conflicting duplicate result IDs across current report snapshots are
 * quarantined from this read-only view. No historical report is rewritten.
 */
export function currentReportResultPointers(
  reports: readonly OrderedCurrentReportEvidence[],
): Map<string, ReportResultPointer> {
  const pointers = new Map<string, ReportResultPointer>();
  const disputed = new Set<string>();
  for (const report of reports) {
    if (typeof report.orderId !== "string" || !report.orderId) continue;
    const current = report.versions.find(version => version.version === report.currentVersion);
    if (!current || !["PARTIAL", "FINAL", "AMENDED"].includes(current.status) ||
        !Array.isArray(current.resultVersionSnapshot)) continue;
    for (const raw of current.resultVersionSnapshot) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
      const pointer = raw as Record<string, unknown>;
      if (typeof pointer.resultId !== "string" || !pointer.resultId ||
          typeof pointer.orderItemId !== "string" || !pointer.orderItemId ||
          !Number.isSafeInteger(pointer.resultVersion) || (pointer.resultVersion as number) < 1)
        continue;
      const id = pointer.resultId;
      const expected: ReportResultPointer = {
        orderId: report.orderId,
        orderItemId: pointer.orderItemId,
        resultVersion: pointer.resultVersion as number,
      };
      const previous = pointers.get(id);
      if (previous && (
        previous.orderId !== expected.orderId ||
        previous.orderItemId !== expected.orderItemId ||
        previous.resultVersion !== expected.resultVersion
      )) {
        disputed.add(id);
        pointers.delete(id);
      } else if (!disputed.has(id)) {
        pointers.set(id, expected);
      }
    }
  }
  return pointers;
}

export function resultMatchesCurrentReportPointer(
  result: { id: string; orderItemId: string; version: number; orderItem: {
    order: { id: string };
  } },
  pointers: ReadonlyMap<string, ReportResultPointer>,
): boolean {
  const pointer = pointers.get(result.id);
  return pointer !== undefined &&
    pointer.orderId === result.orderItem.order.id &&
    pointer.orderItemId === result.orderItemId &&
    pointer.resultVersion === result.version;
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
  methodId: string | null;
  analyzerCode: string | null;
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
      methodId: point.methodId || null,
      analyzerCode: point.analyzerCode || null,
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
