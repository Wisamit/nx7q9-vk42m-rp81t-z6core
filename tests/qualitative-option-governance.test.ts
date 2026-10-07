import test from "node:test";
import assert from "node:assert/strict";
import {
  planQualitativeOptionApproval,
  qualitativeOptionClinicallyUsable,
  qualitativeOptionWindowsOverlap,
  sameQualitativeOptionIdentity,
} from "../src/lib/qualitative-option-governance.ts";

const base = {
  id: "OPT-1",
  testId: "TEST-1",
  componentId: "COMP-1",
  code: "DETECTED",
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
  effectiveTo: null,
};

test("qualitative semantics are clinically usable only after explicit approval", () => {
  assert.equal(qualitativeOptionClinicallyUsable({
    status: "ACTIVE",
    approvalStatus: "APPROVED",
    approvedAt: new Date("2026-01-01T00:00:00.000Z"),
  }), true);

  assert.equal(qualitativeOptionClinicallyUsable({
    status: "INACTIVE",
    approvalStatus: "APPROVED",
    approvedAt: new Date("2026-01-01T00:00:00.000Z"),
  }), false);

  assert.equal(qualitativeOptionClinicallyUsable({
    status: "ACTIVE",
    approvalStatus: "DRAFT",
    approvedAt: null,
  }), false);

  assert.equal(qualitativeOptionClinicallyUsable({
    status: "ACTIVE",
    approvalStatus: "APPROVED",
    approvedAt: null,
  }), false);
});

test("qualitative option identity is scoped by test component and stable code", () => {
  assert.equal(sameQualitativeOptionIdentity(base, { ...base, id: "OPT-2" }), true);
  assert.equal(sameQualitativeOptionIdentity(base, { ...base, id: "OPT-2", testId: "TEST-2" }), false);
  assert.equal(sameQualitativeOptionIdentity(base, { ...base, id: "OPT-2", componentId: "COMP-2" }), false);
  assert.equal(sameQualitativeOptionIdentity(base, { ...base, id: "OPT-2", code: "NOT_DETECTED" }), false);
});

test("qualitative semantic effective windows use closed overlap rules", () => {
  assert.equal(qualitativeOptionWindowsOverlap(
    { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null },
    { effectiveFrom: new Date("2026-06-01T00:00:00.000Z"), effectiveTo: null },
  ), true);
  assert.equal(qualitativeOptionWindowsOverlap(
    { effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: new Date("2026-02-01T00:00:00.000Z") },
    { effectiveFrom: new Date("2026-03-01T00:00:00.000Z"), effectiveTo: null },
  ), false);
});

test("later approved semantic version safely closes its predecessor", () => {
  const draft = { ...base, id: "NEW", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") };
  const old = { ...base, id: "OLD", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") };
  assert.deepEqual(planQualitativeOptionApproval(draft, [old]), {
    predecessorsToClose: ["OLD"],
    conflicts: [],
  });
});

test("same or later overlapping semantic version blocks approval", () => {
  const draft = { ...base, id: "NEW", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") };
  const same = { ...base, id: "SAME", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") };
  const later = { ...base, id: "LATER", effectiveFrom: new Date("2026-07-01T00:00:00.000Z") };
  assert.deepEqual(planQualitativeOptionApproval(draft, [same, later]), {
    predecessorsToClose: [],
    conflicts: ["SAME", "LATER"],
  });
});

test("different semantic code can coexist in the same qualitative field", () => {
  const draft = { ...base, id: "POS", code: "POSITIVE", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") };
  const negative = { ...base, id: "NEG", code: "NEGATIVE", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") };
  assert.deepEqual(planQualitativeOptionApproval(draft, [negative]), {
    predecessorsToClose: [],
    conflicts: [],
  });
});
