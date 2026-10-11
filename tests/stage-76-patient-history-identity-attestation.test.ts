import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  publishedHistoryEvidence, resultMatchesPublishedHistory,
  type PublishedHistoryReport, type HistoryCandidate,
} from "../src/lib/patient-history-published.ts";

function report() {
  return {
    organizationId: "ORG-A",
    orderId: "ORDER-A",
    order: { id: "ORDER-A", patientId: "ALIAS-OLD", accessionNumber: "ACC-A", orderingBranchId: "B-ORDER" },
    currentVersion: 1,
    versions: [{
      version: 1, status: "FINAL",
      resultVersionSnapshot: [{ resultId: "R1", orderItemId: "I1", resultVersion: 1 }],
      contentSnapshot: {
        organization: { id: "ORG-A" },
        branch: { id: "B-ORDER" },
        patient: { id: "ALIAS-OLD", patientNumber: "P-OLD" },
        order: { id: "ORDER-A", accessionNumber: "ACC-A" },
        results: [{
          resultId: "R1", orderItemId: "I1", resultVersion: 1,
          testId: "TEST-1", methodId: null, analyzer: null,
          performingBranch: { id: "B-PERFORM" },
          values: [{ componentId: "C1", componentCode: "HB", componentNameEn: "Hemoglobin",
            componentNameAr: null, displayValue: "13.5", unit: "g/dL",
            flag: "NORMAL", isCritical: false, referenceLow: "12",
            referenceHigh: "16", referenceTextEn: null, referenceTextAr: null }],
        }],
      },
    }],
  } satisfies PublishedHistoryReport;
}
function result() {
  return {
    id: "R1", orderItemId: "I1", version: 1, performingBranchId: "B-PERFORM",
    methodId: null, analyzerCodeSnapshot: null,
    orderItem: {
      testId: "TEST-1",
      order: { id: "ORDER-A", organizationId: "ORG-A", patientId: "ALIAS-OLD",
        accessionNumber: "ACC-A", orderingBranchId: "B-ORDER" },
    },
    values: [{
      componentId: "C1", componentCodeSnapshot: "HB",
      componentNameEnSnapshot: "Hemoglobin", componentNameArSnapshot: null,
      reportNameEnSnapshot: null, reportNameArSnapshot: null,
      displayValue: "13.5", unitSnapshot: "g/dL", flag: "NORMAL",
      isCritical: false,
      referenceLowSnapshot: { toString: () => "12" },
      referenceHighSnapshot: { toString: () => "16" },
      referenceTextEnSnapshot: null, referenceTextArSnapshot: null,
    }],
  } satisfies HistoryCandidate;
}
const freeze = (value: ReturnType<typeof report>) =>
  value.versions[0].contentSnapshot;

test("Stage 76: historical merged alias retains its original signed patient identity", () => {
  const evidence = publishedHistoryEvidence([report()]);
  assert.equal(evidence.size, 1);
  assert.equal(resultMatchesPublishedHistory(result(), evidence), true);
  // Replacing historical patient ID with today's canonical record is not a
  // legal rewrite of the historical order/report.
  const canonicalCandidate = result();
  canonicalCandidate.orderItem.order.patientId = "CANONICAL-NEW";
  assert.equal(resultMatchesPublishedHistory(canonicalCandidate, evidence), false);
});

test("Stage 76: all four report-to-order identity mismatches and omissions fail closed", () => {
  const corrections = [
    (x: ReturnType<typeof report>) => { freeze(x).organization.id = "OTHER-TENANT"; },
    (x: ReturnType<typeof report>) => { freeze(x).branch.id = "B-PERFORM"; },
    (x: ReturnType<typeof report>) => { freeze(x).patient.id = "WRONG-PATIENT"; },
    (x: ReturnType<typeof report>) => { freeze(x).order.id = "WRONG-ORDER"; },
    (x: ReturnType<typeof report>) => { freeze(x).order.accessionNumber = "WRONG-ACCESSION"; },
    (x: ReturnType<typeof report>) => { x.order.id = "WRONG-ORDER"; },
    (x: ReturnType<typeof report>) => { x.organizationId = "WRONG-TENANT"; },
    (x: ReturnType<typeof report>) => { x.order.patientId = "WRONG-PATIENT"; },
    (x: ReturnType<typeof report>) => { x.order.orderingBranchId = "WRONG-ORDER-BRANCH"; },
    (x: ReturnType<typeof report>) => { x.order.accessionNumber = "WRONG-ACCESSION"; },
    (x: ReturnType<typeof report>) => { delete (freeze(x) as Record<string, unknown>).patient; },
    (x: ReturnType<typeof report>) => { delete (freeze(x) as Record<string, unknown>).organization; },
    (x: ReturnType<typeof report>) => { delete (freeze(x) as Record<string, unknown>).branch; },
  ];
  for (const [index, modify] of corrections.entries()) {
    const row = report();
    modify(row);
    assert.equal(publishedHistoryEvidence([row]).size, 0, "corrupted identity #" + index);
  }
});

test("Stage 76: live order provenance must still match issued evidence after report loading", () => {
  const evidence = publishedHistoryEvidence([report()]);
  for (const key of ["organizationId", "patientId", "accessionNumber", "orderingBranchId", "id"] as const) {
    const value = result();
    value.orderItem.order[key] = "WRONG";
    assert.equal(resultMatchesPublishedHistory(value, evidence), false, key);
  }
  const badBranch = result();
  badBranch.performingBranchId = "B-ORDER";
  assert.equal(resultMatchesPublishedHistory(badBranch, evidence), false);
});

test("Stage 76: current released report and explicit branch filtering guard BOTH 20-page tables and 250-report trends", () => {
  const page = readFileSync("src/app/patients/[id]/history/page.tsx", "utf8");
  const helper = readFileSync("src/lib/patient-history-published.ts", "utf8");
  const snapshotBuilder = readFileSync("src/lib/report-snapshot.ts", "utf8");
  assert.match(page, /organizationId: true,\s*orderId: true,\s*order:/);
  assert.match(page, /patientId: true, accessionNumber: true, orderingBranchId: true/);
  assert.match(page, /publishedHistoryEvidence\(trendWindow\.chartEvidence\)/);
  assert.match(page, /resultMatchesPublishedHistory\(result, publishedEvidence\)/);
  assert.match(page, /performingBranchId: \{ in: branchIds \}/);
  assert.match(page, /patientId: \{ in: patientIds \}/);
  assert.match(helper, /content\.organization\.id !== report\.organizationId/);
  assert.match(helper, /content\.branch\.id !== report\.order\.orderingBranchId/);
  assert.match(helper, /content\.patient\.id !== report\.order\.patientId/);
  assert.match(helper, /content\.order\.accessionNumber !== report\.order\.accessionNumber/);
  assert.match(snapshotBuilder, /organization: \{/);
  assert.match(snapshotBuilder, /patient: \{/);
  assert.match(snapshotBuilder, /branch: \{/);
});
