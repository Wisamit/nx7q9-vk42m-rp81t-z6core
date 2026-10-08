import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(file: string) {
  return readFileSync(new URL("../" + file, import.meta.url), "utf8");
}

test("new patient registration requires binary sex selection and explicit age unit", () => {
  const ui = source("src/components/patient-create-form.tsx");
  const api = source("src/app/api/patients/route.ts");
  assert.ok(ui.includes('name="recordedAgeValue"'));
  assert.ok(ui.includes('name="recordedAgeUnit"'));
  assert.ok(ui.includes('<option value="MONTH">'));
  assert.ok(ui.includes('<option value="DAY">'));
  assert.ok(ui.includes('<option value="YEAR">'));
  assert.ok(ui.includes('defaultValue="" required'));
  assert.ok(api.includes('error: "sex_required"'));
  assert.ok(api.includes('error: "invalid_recorded_age"'));
  assert.ok(api.includes("recordedAgeAt: new Date()"));
  assert.ok(!api.includes("new Date(Date.now() - recordedAgeValue"));
});

test("new patient form has no passport field and a single free-language address", () => {
  const ui = source("src/components/patient-create-form.tsx");
  assert.ok(!ui.includes('name="passportNumber"'));
  assert.ok(!ui.includes('name="passportIssuingCountry"'));
  assert.ok(ui.includes('name="address"'));
  assert.ok(!ui.includes('name="addressEn"'));
  assert.ok(!ui.includes('name="addressAr"'));
});

test("patient edits preserve recorded age timestamp on unrelated changes", () => {
  const api = source("src/app/api/patients/[id]/route.ts");
  assert.ok(api.includes("patient.recordedAgeValue !== recordedAgeValue"));
  assert.ok(api.includes("patient.recordedAgeAt"));
  assert.ok(api.includes("recordedAgeValue,"));
  assert.ok(api.includes("address: address || null"));
});

test("patient age migration never backfills fabricated legacy age or date of birth", () => {
  const migration = source("prisma/migrations/20261008135000_patient_age_and_address/migration.sql");
  assert.ok(migration.includes("ADD COLUMN `recorded_age_value`"));
  assert.ok(migration.includes("ADD COLUMN `recorded_age_unit`"));
  assert.ok(!migration.includes("UPDATE `patients`"));
});
