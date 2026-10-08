import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("patient updates require reason and optimistic concurrency evidence", () => {
  const route = source("src/app/api/patients/[id]/route.ts");
  assert.ok(route.includes('requirePermission("patients.manage")'));
  assert.ok(route.includes("expected_updated_at_required"));
  assert.ok(route.includes("change_reason_required"));
  assert.ok(route.includes("updatedAt: expectedUpdatedAt"));
  assert.ok(route.includes("patient_state_changed"));
  assert.ok(route.includes('action: "PATIENT_UPDATED"'));
});

test("patient updates reject inactive or merged aliases", () => {
  const route = source("src/app/api/patients/[id]/route.ts");
  assert.ok(route.includes('patient.status !== "ACTIVE" || patient.mergedIntoPatientId'));
  assert.ok(route.includes("patient_not_editable"));
});

test("patient identity changes rerun duplicate review before saving", () => {
  const route = source("src/app/api/patients/[id]/route.ts");
  assert.ok(route.includes("patientDuplicateEvidence"));
  assert.ok(route.includes('error: "possible_duplicates"'));
  assert.ok(route.includes("PATIENT_DUPLICATE_REVIEW_OVERRIDE"));
});

test("patient create and update reject future birth dates", () => {
  const createRoute = source("src/app/api/patients/route.ts");
  const updateRoute = source("src/app/api/patients/[id]/route.ts");
  assert.ok(createRoute.includes("future_date_of_birth"));
  assert.ok(updateRoute.includes("future_date_of_birth"));
});

test("released reports retain patient identity in immutable report snapshots", () => {
  const snapshot = source("src/lib/report-snapshot.ts");
  const report = source("src/app/reports/[orderId]/page.tsx");
  assert.ok(snapshot.includes("contentSnapshot"));
  assert.ok(snapshot.includes("patientNumber: order.patient.patientNumber"));
  assert.ok(snapshot.includes("fullNameEn: order.patient.fullNameEn"));
  assert.ok(report.includes("latest.contentSnapshot"));
});
