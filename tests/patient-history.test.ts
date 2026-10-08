import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPatientTrendSeries,
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
  const { readFileSync } = require("node:fs");
  const page = readFileSync(new URL("../src/app/patients/[id]/history/page.tsx", import.meta.url), "utf8");

  assert.ok(page.includes('performingBranchId: { in: branchIds }'));
  assert.ok(!page.includes('orderingBranchId: { in: branchIds },\n            },\n            ...itemDepartmentFilter'));
  assert.ok(page.includes('where: { reportVisibleSnapshot: { not: false } }'));
  assert.ok(page.includes('reportNameEnSnapshot || value.componentNameEnSnapshot'));
  assert.ok(page.includes('reportNameArSnapshot || value.componentNameArSnapshot'));
});
