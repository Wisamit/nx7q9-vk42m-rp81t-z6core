import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string) {
  return readFileSync(new URL("../" + path, import.meta.url), "utf8");
}

test("new orders snapshot patient demographics at creation", () => {
  const route = source("src/app/api/orders/route.ts");
  for (const field of ["patientSexSnapshot:", "patientDobSnapshot:", "patientAgeValueSnapshot:", "patientAgeUnitSnapshot:", "patientAgeRecordedAtSnapshot:"]) {
    assert.ok(route.includes(field), field);
  }
});

test("manual and analyzer results resolve age and sex from order evidence, never live patient fields", () => {
  for (const path of ["src/app/api/results/route.ts", "src/app/api/analyzers/imports/commit/route.ts"]) {
    const route = source(path);
    assert.ok(route.includes("orderItem.order.patientSexSnapshot"));
    assert.ok(route.includes("orderItem.order.patientDobSnapshot"));
    assert.ok(route.includes("orderItem.order.patientAgeValueSnapshot"));
    assert.ok(route.includes("ageAsOf: orderItem.order.orderedAt"));
    assert.ok(!route.includes("orderItem.order.patient.dateOfBirth"));
    assert.ok(!route.includes("orderItem.order.patient.recordedAgeValue"));
    assert.ok(!route.includes("orderItem.order.patient.sexAtBirth"));
  }
});

test("migration never retroactively guesses patient demographic context for old orders", () => {
  const sql = source("prisma/migrations/20261008152000_order_demographic_snapshots/migration.sql");
  assert.ok(sql.includes("ADD COLUMN `patient_age_value_snapshot`"));
  assert.ok(!sql.includes("UPDATE `lab_orders`"));
});
