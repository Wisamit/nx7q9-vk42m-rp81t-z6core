import test from "node:test";
import assert from "node:assert/strict";
import {
  compareReportPresentation,
  reportValueVisible,
  snapshotReportPresentation,
} from "../src/lib/report-presentation.ts";

test("report presentation snapshots configured names, order and section", () => {
  const snapshot = snapshotReportPresentation({
    code: "NEUT",
    nameEn: "Neutrophils",
    nameAr: "العدلات",
    displayOrder: 20,
    reportNameEn: "Neutrophils %",
    reportNameAr: "العدلات %",
    reportDisplayOrder: 5,
    reportVisible: true,
    resultSection: {
      code: "DIFF",
      nameEn: "Differential",
      nameAr: "العد التفريقي",
      displayOrder: 2,
      reportDisplayOrder: 1,
      reportVisible: true,
    },
  });

  assert.deepEqual(snapshot, {
    reportNameEnSnapshot: "Neutrophils %",
    reportNameArSnapshot: "العدلات %",
    reportDisplayOrderSnapshot: 5,
    reportVisibleSnapshot: true,
    reportSectionCodeSnapshot: "DIFF",
    reportSectionNameEnSnapshot: "Differential",
    reportSectionNameArSnapshot: "العد التفريقي",
    reportSectionOrderSnapshot: 1,
  });
});

test("report presentation falls back to component and section display order", () => {
  const snapshot = snapshotReportPresentation({
    code: "HGB",
    nameEn: "Hemoglobin",
    nameAr: "الهيموغلوبين",
    displayOrder: 7,
    reportNameEn: null,
    reportNameAr: null,
    reportDisplayOrder: null,
    reportVisible: true,
    resultSection: {
      code: "CBC",
      nameEn: "CBC",
      nameAr: "صورة الدم",
      displayOrder: 3,
      reportDisplayOrder: null,
      reportVisible: true,
    },
  });

  assert.equal(snapshot.reportNameEnSnapshot, "Hemoglobin");
  assert.equal(snapshot.reportDisplayOrderSnapshot, 7);
  assert.equal(snapshot.reportSectionOrderSnapshot, 3);
});

test("hidden section suppresses all of its component values", () => {
  const snapshot = snapshotReportPresentation({
    code: "INTERNAL",
    nameEn: "Internal Control",
    nameAr: null,
    displayOrder: 1,
    reportNameEn: null,
    reportNameAr: null,
    reportDisplayOrder: null,
    reportVisible: true,
    resultSection: {
      code: "INTERNAL",
      nameEn: "Internal",
      nameAr: null,
      displayOrder: 1,
      reportDisplayOrder: null,
      reportVisible: false,
    },
  });

  assert.equal(snapshot.reportVisibleSnapshot, false);
  assert.equal(reportValueVisible({ reportVisible: snapshot.reportVisibleSnapshot }), false);
});

test("configured report order sorts section then component", () => {
  const values = [
    { componentCode: "B", reportDisplayOrder: 2, reportVisible: true, reportSectionCode: "S2", reportSectionOrder: 2 },
    { componentCode: "C", reportDisplayOrder: 3, reportVisible: true, reportSectionCode: "S1", reportSectionOrder: 1 },
    { componentCode: "A", reportDisplayOrder: 1, reportVisible: true, reportSectionCode: "S1", reportSectionOrder: 1 },
  ].sort(compareReportPresentation);

  assert.deepEqual(values.map(value => value.componentCode), ["A", "C", "B"]);
});

test("legacy values without presentation snapshots preserve component-code ordering", () => {
  const values = [
    { componentCode: "Z", reportDisplayOrder: null, reportVisible: null, reportSectionCode: null, reportSectionOrder: null },
    { componentCode: "A", reportDisplayOrder: null, reportVisible: null, reportSectionCode: null, reportSectionOrder: null },
  ].sort(compareReportPresentation);

  assert.deepEqual(values.map(value => value.componentCode), ["A", "Z"]);
  assert.equal(values.every(reportValueVisible), true);
});
