import test from "node:test";
import assert from "node:assert/strict";
import {
  patientDuplicateEvidence,
  sortDuplicateCandidates,
} from "../src/lib/patient-duplicate-review.ts";

const base = {
  normalizedName: "AHMAD ALI",
  dateOfBirth: new Date("1990-01-15T00:00:00.000Z"),
  normalizedPhone: "+971501234567",
};

test("duplicate evidence distinguishes name+DOB from phone evidence", () => {
  assert.deepEqual(patientDuplicateEvidence(base, { ...base }), ["NAME_DOB", "PHONE"]);
  assert.deepEqual(patientDuplicateEvidence(base, { ...base, normalizedPhone: "+971509999999" }), ["NAME_DOB"]);
  assert.deepEqual(patientDuplicateEvidence(base, { ...base, normalizedName: "OTHER NAME" }), ["PHONE"]);
});

test("duplicate evidence never treats name alone as sufficient", () => {
  assert.deepEqual(patientDuplicateEvidence(
    { ...base, dateOfBirth: null, normalizedPhone: null },
    { ...base, dateOfBirth: null, normalizedPhone: null },
  ), []);
});

test("duplicate candidates sort by evidence count then patient number", () => {
  const sorted = sortDuplicateCandidates([
    { patientNumber: "P-2", evidence: ["PHONE"] as const },
    { patientNumber: "P-3", evidence: ["NAME_DOB", "PHONE"] as const },
    { patientNumber: "P-1", evidence: ["PHONE"] as const },
  ]);
  assert.deepEqual(sorted.map(item => item.patientNumber), ["P-3", "P-1", "P-2"]);
});
