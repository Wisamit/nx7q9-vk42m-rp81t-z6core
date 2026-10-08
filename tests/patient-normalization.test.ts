import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizePatientIdentifier,
  normalizePatientName,
  normalizePatientPhone,
} from "../src/lib/patient-normalization.ts";

test("patient name normalization is case and whitespace stable", () => {
  assert.equal(normalizePatientName("  José   Ahmed  "), "JOSE AHMED");
});

test("patient phone normalization preserves leading plus and digits", () => {
  assert.equal(normalizePatientPhone("+971 50-123 4567"), "+971501234567");
});

test("patient identifier normalization removes formatting", () => {
  assert.equal(normalizePatientIdentifier("a-12 34/xy"), "A1234XY");
});
