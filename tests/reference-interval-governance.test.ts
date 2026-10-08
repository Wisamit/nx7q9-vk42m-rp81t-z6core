import test from "node:test";
import assert from "node:assert/strict";
import {
  planReferenceIntervalApproval,
  referenceIntervalClinicallyUsable,
  referenceIntervalWindowsOverlap,
  sameReferenceIntervalContext,
} from "../src/lib/reference-interval-governance.ts";

const base = {
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
  effectiveTo: null,
};

test("clinical use requires active approved interval with approval timestamp", () => {
  assert.equal(referenceIntervalClinicallyUsable({
    status: "ACTIVE",
    approvalStatus: "APPROVED",
    approvedAt: new Date("2026-01-01T00:00:00.000Z"),
  }), true);

  assert.equal(referenceIntervalClinicallyUsable({
    status: "INACTIVE",
    approvalStatus: "APPROVED",
    approvedAt: new Date("2026-01-01T00:00:00.000Z"),
  }), false);

  assert.equal(referenceIntervalClinicallyUsable({
    status: "ACTIVE",
    approvalStatus: "DRAFT",
    approvedAt: null,
  }), false);

  assert.equal(referenceIntervalClinicallyUsable({
    status: "ACTIVE",
    approvalStatus: "APPROVED",
    approvedAt: null,
  }), false);
});

test("same context compares all clinically meaningful matching dimensions", () => {
  assert.equal(sameReferenceIntervalContext(base, { ...base, id: "R2" }), true);
  assert.equal(sameReferenceIntervalContext(base, { ...base, id: "R2", branchId: "B1" }), false);
  assert.equal(sameReferenceIntervalContext(base, { ...base, id: "R2", analyzerId: "A1" }), false);
  assert.equal(sameReferenceIntervalContext(base, { ...base, id: "R2", pregnancyStatus: "PREGNANT" }), false);
  assert.equal(sameReferenceIntervalContext(base, { ...base, id: "R2", populationCode: "ADULT_UAE" }), false);
});

test("effective windows overlap with open-ended boundaries", () => {
  assert.equal(referenceIntervalWindowsOverlap(
    { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null },
    { effectiveFrom: new Date("2026-06-01T00:00:00.000Z"), effectiveTo: null },
  ), true);
  assert.equal(referenceIntervalWindowsOverlap(
    { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-02-01T00:00:00.000Z") },
    { effectiveFrom: new Date("2026-03-01T00:00:00.000Z"), effectiveTo: null },
  ), false);
});

test("later approved version closes an overlapping predecessor with identical context", () => {
  const draft = { ...base, id: "NEW", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") };
  const previous = { ...base, id: "OLD", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") };
  assert.deepEqual(planReferenceIntervalApproval(draft, [previous]), {
    predecessorsToClose: ["OLD"],
    conflicts: [],
  });
});

test("same or later approved version blocks approval when effective periods overlap", () => {
  const draft = { ...base, id: "NEW", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") };
  const sameStart = { ...base, id: "SAME", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") };
  const later = { ...base, id: "LATER", effectiveFrom: new Date("2026-07-01T00:00:00.000Z") };
  assert.deepEqual(planReferenceIntervalApproval(draft, [sameStart, later]), {
    predecessorsToClose: [],
    conflicts: ["SAME", "LATER"],
  });
});

test("different clinical context does not supersede another approved interval", () => {
  const draft = { ...base, id: "NEW", branchId: "B1", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") };
  const organizationDefault = { ...base, id: "ORG", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") };
  assert.deepEqual(planReferenceIntervalApproval(draft, [organizationDefault]), {
    predecessorsToClose: [],
    conflicts: [],
  });
});
