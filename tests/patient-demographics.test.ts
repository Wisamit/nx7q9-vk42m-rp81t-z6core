import test from "node:test";
import assert from "node:assert/strict";
import { calculatePatientAge } from "../src/lib/patient-demographics.ts";

test("patient age uses days for newborns", () => {
  assert.deepEqual(
    calculatePatientAge(new Date("2026-10-01T00:00:00.000Z"), new Date("2026-10-08T10:00:00.000Z")),
    { value: 7, unit: "DAY" },
  );
});

test("patient age uses completed months below two years", () => {
  assert.deepEqual(
    calculatePatientAge(new Date("2025-11-15T00:00:00.000Z"), new Date("2026-10-08T00:00:00.000Z")),
    { value: 10, unit: "MONTH" },
  );
});

test("patient age uses completed years from two years onward", () => {
  assert.deepEqual(
    calculatePatientAge(new Date("2000-10-20T00:00:00.000Z"), new Date("2026-10-08T00:00:00.000Z")),
    { value: 25, unit: "YEAR" },
  );
});

test("patient age rejects future dates and handles missing DOB", () => {
  assert.equal(calculatePatientAge(null, new Date("2026-10-08T00:00:00.000Z")), null);
  assert.equal(
    calculatePatientAge(new Date("2027-01-01T00:00:00.000Z"), new Date("2026-10-08T00:00:00.000Z")),
    null,
  );
});
