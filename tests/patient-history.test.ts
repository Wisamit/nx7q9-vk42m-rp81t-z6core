import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildPatientTrendSeries,
  currentReportResultIds,
  latestClinicalResultIds,
  patientIdentityGroupIds,
} from "../src/lib/patient-history.ts";

test("patient identity group contains canonical patient and unique aliases", () => {
  assert.deepEqual(patientIdentityGroupIds("P1", ["P2", "P3", "P2", "P1"]), ["P1", "P2", "P3"]);
});

test("longitudinal history selects the newest released or amended result version per order item", () => {
  const selected = latestClinicalResultIds([
    { orderItemId: "I1", version: 1, status: "RELEASED", releasedAt: new Date() },
    { orderItemId: "I1", version: 2, status: "AMENDED", releasedAt: new Date() },
    { orderItemId: "I2", version: 1, status: "DRAFT", releasedAt: null },
    { orderItemId: "I3", version: 1, status: "CANCELLED", releasedAt: null },
    { orderItemId: "I4", version: 1, status: "RELEASED", releasedAt: new Date() },
  ]);
  assert.deepEqual([...selected].sort(), ["I1:2", "I4:1"]);
});

test("trend series never mix the same analyte across different units", () => {
  const base = {
    testId: "T1",
    testCode: "GLU",
    testNameEn: "Glucose",
    testNameAr: "جلوكوز",
    componentId: "C1",
    methodId: "M1",
    analyzerCode: "A1",
    componentCode: "GLU",
    componentNameEn: "Glucose",
    componentNameAr: "جلوكوز",
    flag: "NORMAL",
    accessionNumber: "A1",
    orderId: "O1",
    resultVersion: 1,
  };
  const series = buildPatientTrendSeries([
    { ...base, unit: "mg/dL", valueNumeric: "90", displayValue: "90", observedAt: "2026-01-01T10:00:00.000Z" },
    { ...base, unit: "mg/dL", valueNumeric: "95", displayValue: "95", observedAt: "2026-02-01T10:00:00.000Z" },
    { ...base, unit: "mmol/L", valueNumeric: "5.3", displayValue: "5.3", observedAt: "2026-03-01T10:00:00.000Z" },
  ]);
  assert.equal(series.length, 2);
  assert.deepEqual(series.map(item => item.unit).sort(), ["mg/dL", "mmol/L"]);
  assert.equal(series.find(item => item.unit === "mg/dL")?.points.length, 2);
});

test("trend series use immutable snapshot labels and ignore non-numeric values", () => {
  const series = buildPatientTrendSeries([
    {
      testId: "T2",
      testCode: "CRP",
      testNameEn: "CRP historical",
      testNameAr: null,
      componentId: null,
      componentCode: "CRP",
      componentNameEn: "CRP historical component",
      componentNameAr: null,
      unit: "mg/L",
      valueNumeric: "12.5",
      displayValue: "12.5",
      flag: "HIGH",
      observedAt: "2026-04-01T10:00:00.000Z",
      accessionNumber: "A2",
      orderId: "O2",
      resultVersion: 1,
    },
    {
      testId: "T2",
      testCode: "CRP",
      testNameEn: "CRP historical",
      testNameAr: null,
      componentId: null,
      componentCode: "CRP",
      componentNameEn: "CRP historical component",
      componentNameAr: null,
      unit: "mg/L",
      valueNumeric: null,
      displayValue: "Positive",
      flag: "ABNORMAL",
      observedAt: "2026-05-01T10:00:00.000Z",
      accessionNumber: "A3",
      orderId: "O3",
      resultVersion: 1,
    },
  ]);
  assert.equal(series.length, 1);
  assert.equal(series[0].testNameEn, "CRP historical");
  assert.equal(series[0].componentNameEn, "CRP historical component");
  assert.equal(series[0].points.length, 1);
});


test("patient history page scopes clinical results to performing branch and uses report snapshots", () => {
  const page = readFileSync(new URL("../src/app/patients/[id]/history/page.tsx", import.meta.url), "utf8");

  assert.ok(page.includes('performingBranchId: { in: branchIds }'));
  assert.ok(!page.includes('orderingBranchId: { in: branchIds },\n            },\n            ...itemDepartmentFilter'));
  assert.ok(page.includes('where: { reportVisibleSnapshot: { not: false } }'));
  assert.ok(page.includes('reportNameEnSnapshot || value.componentNameEnSnapshot'));
  assert.ok(page.includes('reportNameArSnapshot || value.componentNameArSnapshot'));
});

test("only explicitly referenced results from the current non-retracted report are current", () => {
  const pointer = (resultId: string) => [{ resultId, orderItemId: "I1", resultVersion: 1 }];
  const ids = currentReportResultIds([
    { currentVersion: 2, versions: [
      { version: 2, status: "RETRACTED", resultVersionSnapshot: pointer("retracted") },
      { version: 1, status: "FINAL", resultVersionSnapshot: pointer("obsolete") },
    ] },
    { currentVersion: 2, versions: [
      { version: 2, status: "AMENDED", resultVersionSnapshot: pointer("corrected") },
      { version: 1, status: "FINAL", resultVersionSnapshot: pointer("old") },
    ] },
    { currentVersion: 3, versions: [
      { version: 2, status: "FINAL", resultVersionSnapshot: pointer("stale") },
    ] },
    { currentVersion: 1, versions: [
      { version: 1, status: "PARTIAL", resultVersionSnapshot: pointer("partial") },
    ] },
    { currentVersion: 1, versions: [
      { version: 1, status: "FINAL", resultVersionSnapshot: [{ resultId: "bad", orderItemId: "I2", resultVersion: "1" }] },
    ] },
  ]);
  assert.deepEqual([...ids].sort(), ["corrected", "partial"]);
});

test("trends split analyzer and method identities and refuse to connect unknown methods", () => {
  const base = {
    testId: "T1", testCode: "CREA", testNameEn: "Creatinine", testNameAr: null,
    componentId: "C1", componentCode: "CREA", componentNameEn: "Creatinine",
    componentNameAr: null, unit: "mg/dL", valueNumeric: "1.0", displayValue: "1.0",
    flag: "NORMAL", observedAt: "2026-01-01T00:00:00.000Z", resultVersion: 1,
  };
  const readings = buildPatientTrendSeries([
    { ...base, methodId: "M1", analyzerCode: "A1", accessionNumber: "1", orderId: "O1" },
    { ...base, methodId: "M1", analyzerCode: "A1", accessionNumber: "2", orderId: "O2" },
    { ...base, methodId: "M2", analyzerCode: "A1", accessionNumber: "3", orderId: "O3" },
    { ...base, methodId: "M1", analyzerCode: "A2", accessionNumber: "4", orderId: "O4" },
    { ...base, methodId: null, analyzerCode: null, accessionNumber: "5", orderId: "O5" },
    { ...base, methodId: null, analyzerCode: null, accessionNumber: "6", orderId: "O6" },
  ]);
  assert.equal(readings.length, 5);
  assert.equal(readings.filter(row => row.points.length === 2).length, 1);
  assert.equal(readings.filter(row => !row.comparable).length, 2);
});

test("history uses current report revision evidence and branch-scoped patient attachments", () => {
  const page = readFileSync(new URL("../src/app/patients/[id]/history/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("currentReportResultIds(releaseEvidence)"));
  assert.ok(page.includes("id: { in: [...currentResultIds] }"));
  assert.ok(page.includes('select: { version: true, status: true, resultVersionSnapshot: true }'));
  assert.ok(page.includes('targetType: "PATIENT", targetId: { in: patientIds }, branchId: { in: branchIds }'));
});
