import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  compareCurrentReportWithPrevious,
  extractCurrentReportReadings,
  type ReportComparisonEvidence,
} from "../src/lib/report-cumulative.ts";

function fixture({
  orderId, ordered, issued, branch = "B1", version = 1, status = "FINAL",
  method = "METHOD1", analyzer = "AN1", unit = "mg/dL", value = "90",
  testId = "T1", componentId = "C1", pointerMatches = true,
}: {
  orderId: string; ordered: string; issued: string; branch?: string; version?: number;
  status?: string; method?: string | null; analyzer?: string | null;
  unit?: string; value?: string; testId?: string | null; componentId?: string | null;
  pointerMatches?: boolean;
}): ReportComparisonEvidence {
  const resultId = orderId + "-r";
  const itemId = orderId + "-i";
  return {
    currentVersion: version,
    order: { id: orderId, patientId: "PATIENT-1", accessionNumber: orderId, orderedAt: new Date(ordered) },
    versions: [{
      version, status, issuedAt: new Date(issued),
      resultVersionSnapshot: [{
        orderItemId: itemId, resultId: pointerMatches ? resultId : "WRONG", resultVersion: 1,
      }],
      contentSnapshot: { order: { id: orderId, accessionNumber: orderId }, patient: { id: "PATIENT-1" }, results: [{
        orderItemId: itemId, resultId, resultVersion: 1,
        testId, testCode: "GLU", testNameEn: "Glucose", testNameAr: "غلوكوز",
        methodId: method, analyzer: analyzer ? { code: analyzer } : null,
        performingBranch: { id: branch, code: branch },
        values: [{
          componentId, componentCode: "GLU", componentNameEn: "Glucose",
          componentNameAr: "غلوكوز", displayValue: value, unit,
          flag: "NORMAL", referenceLow: "70", referenceHigh: "100",
          referenceTextEn: "70–100", referenceTextAr: "70–100",
        }],
      }] },
    }],
  };
}
const today = fixture({ orderId: "CURRENT", ordered: "2026-10-08", issued: "2026-10-09", value: "95" });
const previous = fixture({ orderId: "OLD", ordered: "2026-04-01", issued: "2026-04-02" });

test("current report compares only matching immutable released snapshots", () => {
  const comparisons = compareCurrentReportWithPrevious(today, [previous], ["B1"]);
  assert.equal(comparisons.length, 1);
  assert.equal(comparisons[0].current.value, "95");
  assert.equal(comparisons[0].previous?.value, "90");
  assert.equal(comparisons[0].previous?.referenceTextEn, "70–100");
  assert.equal(comparisons[0].previous?.accessionNumber, "OLD");
  assert.equal(comparisons[0].reason, "MATCH");
});

test("different unit, method, analyzer or catalog identity can never be compared", () => {
  const candidates = [
    fixture({ orderId: "UNIT", ordered: "2026-01-01", issued: "2026-01-02", unit: "mmol/L" }),
    fixture({ orderId: "METHOD", ordered: "2026-01-01", issued: "2026-01-02", method: "METHOD2" }),
    fixture({ orderId: "ANALYZER", ordered: "2026-01-01", issued: "2026-01-02", analyzer: "AN2" }),
    fixture({ orderId: "TEST", ordered: "2026-01-01", issued: "2026-01-02", testId: "T2" }),
    fixture({ orderId: "COMPONENT", ordered: "2026-01-01", issued: "2026-01-02", componentId: "C2" }),
  ];
  assert.equal(compareCurrentReportWithPrevious(today, candidates, ["B1"])[0].reason, "NO_COMPARABLE");
  const unknown = fixture({ orderId: "UNKNOWN", ordered: "2026-10-08", issued: "2026-10-09", method: null });
  assert.equal(compareCurrentReportWithPrevious(unknown, [previous], ["B1"])[0].reason, "METHOD_UNKNOWN");
});

test("retracted, superseded, future, unauthorized and broken evidence is not disclosed", () => {
  assert.deepEqual(extractCurrentReportReadings(fixture({ ...{
    orderId: "R", ordered: "2026-01-01", issued: "2026-01-02", status: "RETRACTED",
  } }), ["B1"]), []);
  assert.deepEqual(extractCurrentReportReadings(fixture({
    orderId: "BROKEN", ordered: "2026-01-01", issued: "2026-01-02", pointerMatches: false,
  }), ["B1"]), []);
  const older = fixture({ orderId: "LATER", ordered: "2026-01-01", issued: "2026-11-01" });
  const restricted = fixture({ orderId: "OTHERBRANCH", ordered: "2026-02-01", issued: "2026-02-02", branch: "B2" });
  assert.equal(compareCurrentReportWithPrevious(today, [older, restricted], ["B1"])[0].reason, "NO_COMPARABLE");
  assert.equal(compareCurrentReportWithPrevious(today, [previous], ["B2"]).length, 0);
});

test("report detail keeps comparison outside signed PDF and scopes prior report discovery", () => {
  const s = readFileSync(new URL("../src/app/reports/[orderId]/page.tsx", import.meta.url), "utf8");
  assert.ok(s.includes('organizationId: session.user.organizationId,'));
  assert.ok(s.includes('patientId: { in: linkedPatientIds }'));
  assert.ok(s.includes('orderingBranchId: { in: activeBranchIds }'));
  assert.ok(s.includes('authorizedDepartmentIds(session).length === 0'));
  assert.ok(s.includes('take: 101'));
  assert.ok(s.indexOf('</article>') < s.indexOf('<ReportCumulativeComparison'));
  const component = readFileSync(new URL("../src/components/report-cumulative-comparison.tsx", import.meta.url), "utf8");
  assert.ok(component.includes('report-history no-print'));
  assert.ok(component.includes('More') || component.includes('older records exist'));
});
