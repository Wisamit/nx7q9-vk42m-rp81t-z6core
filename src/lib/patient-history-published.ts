import { currentReportResultPointers, type OrderedCurrentReportEvidence } from "./patient-history.ts";

type Obj = Record<string, unknown>;
const obj = (x: unknown): x is Obj => x !== null && typeof x === "object" && !Array.isArray(x);
const val = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const nullable = (x: unknown) => x === null || typeof x === "string";

export type PublishedHistoryReport = Omit<OrderedCurrentReportEvidence, "versions"> & {
  versions: readonly { version: number; status: string; resultVersionSnapshot: unknown; contentSnapshot: unknown }[];
};
type FrozenReading = {
  orderId: string; orderItemId: string; version: number; testId: string;
  branchId: string; methodId: string | null; analyzerCode: string | null;
  values: Map<string, Obj>;
};
export type HistoryCandidate = {
  id: string; orderItemId: string; version: number;
  performingBranchId: string; methodId: string | null; analyzerCodeSnapshot: string | null;
  orderItem: { testId: string; order: { id: string } };
  values: readonly {
    componentId: string | null; componentCodeSnapshot: string;
    reportNameEnSnapshot: string | null; componentNameEnSnapshot: string;
    reportNameArSnapshot: string | null; componentNameArSnapshot: string | null;
    displayValue: string; unitSnapshot: string | null;
    flag: string; isCritical: boolean;
    referenceLowSnapshot: { toString(): string } | null;
    referenceHighSnapshot: { toString(): string } | null;
    referenceTextEnSnapshot: string | null; referenceTextArSnapshot: string | null;
  }[];
};

// Only a current released report's full frozen observation may back a history row.
// Conflicting/ambiguous rows fail closed; never silently repair clinical history.
export function publishedHistoryEvidence(reports: readonly PublishedHistoryReport[]) {
  const pointers = currentReportResultPointers(reports);
  const evidence = new Map<string, FrozenReading>();
  const disputed = new Set<string>();
  for (const report of reports) {
    const v = report.versions.find(item => item.version === report.currentVersion);
    if (!v || !["FINAL", "PARTIAL", "AMENDED"].includes(v.status)) continue;
    const content = v.contentSnapshot;
    if (!obj(content) || !obj(content.order) || content.order.id !== report.orderId ||
      !Array.isArray(content.results)) continue;
    for (const row of content.results) {
      if (!obj(row) || !val(row.resultId) || !val(row.orderItemId) ||
        !Number.isSafeInteger(row.resultVersion) || !val(row.testId) ||
        !obj(row.performingBranch) || !val(row.performingBranch.id) ||
        !nullable(row.methodId) || !Array.isArray(row.values)) continue;
      const pointer = pointers.get(row.resultId);
      if (!pointer || pointer.orderId !== report.orderId ||
        pointer.orderItemId !== row.orderItemId ||
        pointer.resultVersion !== row.resultVersion || disputed.has(row.resultId)) continue;
      if (evidence.has(row.resultId)) {
        evidence.delete(row.resultId);
        disputed.add(row.resultId);
        continue;
      }
      const analyzer = row.analyzer === null ? null :
        obj(row.analyzer) && val(row.analyzer.code) ? row.analyzer.code : undefined;
      if (analyzer === undefined) continue;
      const values = new Map<string, Obj>();
      let safe = true;
      for (const value of row.values) {
        if (!obj(value) || !val(value.componentCode) ||
          !val(value.componentNameEn) || typeof value.displayValue !== "string" ||
          typeof value.flag !== "string" || typeof value.isCritical !== "boolean" ||
          !nullable(value.componentId) || !nullable(value.componentNameAr) ||
          !nullable(value.unit) || !nullable(value.referenceLow) ||
          !nullable(value.referenceHigh) || !nullable(value.referenceTextEn) ||
          !nullable(value.referenceTextAr) || values.has(value.componentCode)) {
          safe = false;
          break;
        }
        values.set(value.componentCode, value);
      }
      if (!safe) continue;
      evidence.set(row.resultId, { orderId: report.orderId, orderItemId: row.orderItemId,
        version: row.resultVersion as number, testId: row.testId,
        branchId: row.performingBranch.id, methodId: row.methodId as string | null,
        analyzerCode: analyzer, values });
    }
  }
  return evidence;
}

export function resultMatchesPublishedHistory(
  result: HistoryCandidate,
  evidence: ReadonlyMap<string, FrozenReading>,
): boolean {
  const published = evidence.get(result.id);
  if (!published || published.orderId !== result.orderItem.order.id ||
    published.orderItemId !== result.orderItemId || published.version !== result.version ||
    published.testId !== result.orderItem.testId ||
    published.branchId !== result.performingBranchId ||
    published.methodId !== result.methodId ||
    published.analyzerCode !== result.analyzerCodeSnapshot ||
    published.values.size !== result.values.length) return false;

  return result.values.every(value => {
    const frozen = published.values.get(value.componentCodeSnapshot);
    return frozen !== undefined &&
      frozen.componentId === value.componentId &&
      frozen.componentNameEn === (value.reportNameEnSnapshot || value.componentNameEnSnapshot) &&
      frozen.componentNameAr === (value.reportNameArSnapshot || value.componentNameArSnapshot) &&
      frozen.displayValue === value.displayValue &&
      frozen.unit === value.unitSnapshot &&
      frozen.flag === value.flag &&
      frozen.isCritical === value.isCritical &&
      frozen.referenceLow === (value.referenceLowSnapshot?.toString() ?? null) &&
      frozen.referenceHigh === (value.referenceHighSnapshot?.toString() ?? null) &&
      frozen.referenceTextEn === value.referenceTextEnSnapshot &&
      frozen.referenceTextAr === value.referenceTextArSnapshot;
  });
}

// Chart the number printed on the released report rather than an unprinted
// internal precision or a qualified textual observation. No unit conversion.
export function publishedNumericValue(display: string, hadNumericResult: boolean): string | null {
  const normalized = display.trim();
  if (!hadNumericResult ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized) ||
    !Number.isFinite(Number(normalized))) return null;
  return normalized;
}
