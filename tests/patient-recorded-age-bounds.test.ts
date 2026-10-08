import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("recorded ages accept day and month maximums while respecting unit limits", () => {
  for (const path of [
    "../src/app/api/patients/route.ts",
    "../src/app/api/patients/[id]/route.ts",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.ok(source.includes('/^(0|[1-9][0-9]{0,4})$/.test(ageText)'));
    assert.ok(source.includes('ageUnit === "YEAR" && recordedAgeValue > 150'));
    assert.ok(source.includes('ageUnit === "MONTH" && recordedAgeValue > 1800'));
    assert.ok(source.includes('ageUnit === "DAY" && recordedAgeValue > 54787'));
  }
  for (const path of [
    "../src/components/patient-create-form.tsx",
    "../src/components/patient-edit-form.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.ok(source.includes('max={recordedAgeUnit === "DAY" ? 54787 : recordedAgeUnit === "MONTH" ? 1800 : 150}'));
    assert.ok(source.includes('onChange={event => setRecordedAgeUnit(event.target.value)}'));
  }
});
