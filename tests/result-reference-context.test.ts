import test from "node:test";
import assert from "node:assert/strict";
import {
  referenceIntervalMatchesContext,
  referenceIntervalSpecificityScore,
  selectBestReferenceInterval,
  type ReferenceIntervalCandidate,
} from "../src/lib/result-reference.ts";

function interval(overrides: Partial<ReferenceIntervalCandidate> = {}): ReferenceIntervalCandidate {
  return {
    id: "R1",
    branchId: null,
    methodId: null,
    analyzerId: null,
    specimenTypeId: null,
    sex: "ANY",
    ageFrom: null,
    ageTo: null,
    ageUnit: null,
    pregnancyStatus: null,
    gestationalAgeFromWeeks: null,
    gestationalAgeToWeeks: null,
    populationCode: null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

const baseContext = {
  branchId: "B1",
  methodId: "M1",
  analyzerId: null,
  specimenTypeId: "SERUM",
  patientSex: "FEMALE" as const,
  dateOfBirth: new Date("1990-01-01T00:00:00.000Z"),
  pregnancyStatus: "UNKNOWN" as const,
  gestationalAgeWeeks: null,
  populationCode: null,
  at: new Date("2026-10-07T00:00:00.000Z"),
};

test("pregnancy-restricted intervals fail closed when pregnancy status is unknown", () => {
  const pregnant = interval({ pregnancyStatus: "PREGNANT" });
  assert.equal(referenceIntervalMatchesContext(pregnant, baseContext), false);
  assert.equal(referenceIntervalMatchesContext(pregnant, {
    ...baseContext,
    pregnancyStatus: "PREGNANT",
  }), true);
});

test("gestational ranges require explicit pregnant status and gestational age", () => {
  const trimester = interval({
    pregnancyStatus: "PREGNANT",
    gestationalAgeFromWeeks: 12,
    gestationalAgeToWeeks: 20,
  });

  assert.equal(referenceIntervalMatchesContext(trimester, {
    ...baseContext,
    pregnancyStatus: "PREGNANT",
    gestationalAgeWeeks: null,
  }), false);
  assert.equal(referenceIntervalMatchesContext(trimester, {
    ...baseContext,
    pregnancyStatus: "PREGNANT",
    gestationalAgeWeeks: 16,
  }), true);
  assert.equal(referenceIntervalMatchesContext(trimester, {
    ...baseContext,
    pregnancyStatus: "PREGNANT",
    gestationalAgeWeeks: 24,
  }), false);
});

test("analyzer specimen and population restrictions never match absent or different context", () => {
  const restricted = interval({
    analyzerId: "A1",
    specimenTypeId: "SERUM",
    populationCode: "POP-A",
  });

  assert.equal(referenceIntervalMatchesContext(restricted, baseContext), false);
  assert.equal(referenceIntervalMatchesContext(restricted, {
    ...baseContext,
    analyzerId: "A1",
    populationCode: "pop-a",
  }), true);
  assert.equal(referenceIntervalMatchesContext(restricted, {
    ...baseContext,
    analyzerId: "A2",
    populationCode: "POP-A",
  }), false);
});

test("more contextual matches score above generic matches without changing branch override priority", () => {
  const generic = interval({ id: "GENERIC" });
  const analyzerSpecific = interval({ id: "ANALYZER", analyzerId: "A1" });
  const branchSpecific = interval({ id: "BRANCH", branchId: "B1" });
  const context = { ...baseContext, analyzerId: "A1" };

  assert.ok(referenceIntervalSpecificityScore(branchSpecific, context) > referenceIntervalSpecificityScore(analyzerSpecific, context));
  assert.equal(selectBestReferenceInterval([generic, analyzerSpecific, branchSpecific], context)?.id, "BRANCH");
});

test("effective date breaks ties deterministically after equal specificity", () => {
  const older = interval({ id: "OLDER", analyzerId: "A1", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") });
  const newer = interval({ id: "NEWER", analyzerId: "A1", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") });
  assert.equal(selectBestReferenceInterval([older, newer], { ...baseContext, analyzerId: "A1" })?.id, "NEWER");
});

test("recorded six-month infant age matches same-day month intervals without inventing DOB", () => {
  const recordedAt = new Date("2026-10-08T09:00:00.000Z");
  const context = { ...baseContext, dateOfBirth: null, recordedAgeValue: 6, recordedAgeUnit: "MONTH", recordedAgeAt: recordedAt, at: new Date("2026-10-08T10:00:00.000Z") };
  assert.equal(referenceIntervalMatchesContext(interval({ ageFrom: 3, ageTo: 9, ageUnit: "MONTH" }), context), true);
  assert.equal(referenceIntervalMatchesContext(interval({ ageFrom: 7, ageTo: 11, ageUnit: "MONTH" }), context), false);
  assert.equal(referenceIntervalMatchesContext(interval({ ageFrom: 0, ageTo: 1, ageUnit: "YEAR" }), context), false);
});

test("recorded age fails closed if timestamp missing, stale, future, or unit mismatched", () => {
  const candidate = interval({ ageFrom: 5, ageTo: 7, ageUnit: "MONTH" });
  const recordedAt = new Date("2026-10-08T09:00:00.000Z");
  const context = { ...baseContext, dateOfBirth: null, recordedAgeValue: 6, recordedAgeUnit: "MONTH", recordedAgeAt: recordedAt, at: new Date("2026-10-08T10:00:00.000Z") };
  assert.equal(referenceIntervalMatchesContext(candidate, { ...context, recordedAgeAt: null }), false);
  assert.equal(referenceIntervalMatchesContext(candidate, { ...context, at: new Date("2026-10-09T09:00:00.000Z") }), false);
  assert.equal(referenceIntervalMatchesContext(candidate, { ...context, at: new Date("2026-10-08T08:00:00.000Z") }), false);
  assert.equal(referenceIntervalMatchesContext(candidate, { ...context, recordedAgeUnit: "YEAR" }), false);
});
