import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PATIENT_HISTORY_PAGE_SIZE, historyPageSlice, patientHistoryNavigation,
} from "../src/lib/patient-history-pagination.ts";

test("page inputs are bounded and section selection never escalates permissions", () => {
  const available = ["orders", "reports"] as const;
  assert.deepEqual(patientHistoryNavigation("results", "4", available), {
    section: "orders", page: 4, skip: 60, take: 21,
  });
  assert.deepEqual(patientHistoryNavigation("reports", "2", available), {
    section: "reports", page: 2, skip: 20, take: 21,
  });
  for (const invalid of ["0", "-1", "1.1", "Infinity", "1e6", "999999999", "", " 2 ", "null"]) {
    assert.equal(patientHistoryNavigation("orders", invalid, available).page, 1);
  }
  assert.equal(PATIENT_HISTORY_PAGE_SIZE, 20);
});

test("windowing preserves complete 20/21 page boundaries, never confuses the sentinel with visible data", () => {
  const records = Array.from({ length: 41 }, (_, i) => ({ id: "R" + i }));
  const first = historyPageSlice(records.slice(0, 21));
  assert.equal(first.rows.length, 20);
  assert.equal(first.hasNext, true);
  assert.equal(first.rows.at(-1)?.id, "R19");
  const second = historyPageSlice(records.slice(20, 41));
  assert.equal(second.rows.length, 20);
  assert.equal(second.hasNext, true);
  assert.equal(second.rows[0].id, "R20");
  const third = historyPageSlice(records.slice(40, 61));
  assert.equal(third.rows.length, 1);
  assert.equal(third.hasNext, false);
  assert.equal(third.rows[0].id, "R40");
});

test("history page uses independent server windows and release evidence per current report", () => {
  const source = readFileSync(new URL("../src/app/patients/[id]/history/page.tsx", import.meta.url), "utf8");
  assert.ok(source.includes('const reportEvidenceData = canViewReports && section === "results"'));
  assert.ok(source.includes('const ordersData = canViewOrders && section === "orders"'));
  assert.ok(source.includes('const reportVersionsData = canViewReports && section === "reports"'));
  assert.ok(source.includes('const invoicesData = canViewBilling && section === "finance"'));
  assert.ok(source.includes('const attachmentData = canViewAttachments && section === "attachments"'));
  assert.ok((source.match(/skip: navigation.skip/g) || []).length >= 5);
  assert.ok((source.match(/take: navigation.take/g) || []).length >= 5);
  assert.ok(source.includes("currentReportResultPointers(releaseEvidence)"));
  assert.ok(source.includes("resultMatchesCurrentReportPointer(result, currentResultPointers)"));
  assert.ok(source.includes("id: { in: [...currentResultIds] }"));
  assert.ok(source.includes('performingBranchId: { in: branchIds }'));
  assert.ok(source.includes('where: { reportVisibleSnapshot: { not: false } }'));
  assert.ok(source.includes("ONLY this page of up to 20"));
  assert.ok(source.includes('branchId: { in: branchIds }'));
  assert.ok(source.includes('patientId: { in: patientIds }'));
  assert.ok(source.includes('section === "results" && <PatientHistoryPrintButton'));
  assert.ok(source.includes("accessibleSections.map(target"));
  assert.ok(!source.includes("accessibleOrderIds = canViewOrders ? orders.map"));
});

test("attachment search applies tenant, owning branch and patient target SQL before paging", () => {
  const source = readFileSync(new URL("../src/lib/patient-history-attachments.ts", import.meta.url), "utf8");
  assert.ok(source.includes('a.organization_id = ${organizationId}'));
  assert.ok(source.includes('a.branch_id IN (${Prisma.join(branchIds)})'));
  assert.ok(source.includes('a.target_type = \'PATIENT\' AND a.target_id IN (${Prisma.join(patientIds)})'));
  assert.ok(source.includes("o.ordering_branch_id IN"));
  assert.ok(source.includes("r.performing_branch_id IN"));
  assert.ok(source.includes("v.version = d.current_version"));
  assert.ok(source.includes("v.status IN ('PARTIAL','FINAL','AMENDED')"));
  assert.ok(source.includes("JSON_CONTAINS(v.result_version_snapshot"));
  assert.ok(source.includes("t.department_id IN"));
  assert.ok(source.includes("ORDER BY a.created_at DESC, a.id DESC"));
  assert.ok(source.includes("LIMIT ${take} OFFSET ${skip}"));
});
