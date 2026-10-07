import test from "node:test";
import assert from "node:assert/strict";
import {
  automatedTechnicalReviewOutcome,
  isResultEntryLockedByValidation,
  medicalReviewerAllowed,
  selectValidationPolicy,
  snapshotValidationPolicy,
  stageAfterTechnicalReview,
} from "../src/lib/result-validation.ts";

const base = {
  nameEn: "Policy",
  nameAr: null,
  branchId: null,
  requiresMedicalValidation: false,
  allowSameReviewer: false,
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  effectiveTo: null,
};

test("validation policy precedence is test over department over organization", () => {
  const policies = [
    { ...base, id: "ORG", code: "ORG", scope: "ORGANIZATION" as const, departmentId: null, testId: null },
    { ...base, id: "DEP", code: "DEP", scope: "DEPARTMENT" as const, departmentId: "D1", testId: null },
    { ...base, id: "TEST", code: "TEST", scope: "TEST" as const, departmentId: null, testId: "T1" },
  ];

  assert.equal(selectValidationPolicy(policies, { branchId: "B1", testId: "T1", departmentId: "D1" })?.id, "TEST");
  assert.equal(selectValidationPolicy(policies, { branchId: "B1", testId: "T2", departmentId: "D1" })?.id, "DEP");
  assert.equal(selectValidationPolicy(policies, { branchId: "B1", testId: "T2", departmentId: "D2" })?.id, "ORG");
});

test("branch-specific validation policy wins within the same clinical scope", () => {
  const policies = [
    { ...base, id: "GLOBAL_TEST", code: "GLOBAL_TEST", scope: "TEST" as const, branchId: null, departmentId: null, testId: "T1" },
    { ...base, id: "BRANCH_TEST", code: "BRANCH_TEST", scope: "TEST" as const, branchId: "B1", departmentId: null, testId: "T1", requiresMedicalValidation: true },
  ];

  assert.equal(selectValidationPolicy(policies, { branchId: "B1", testId: "T1", departmentId: "D1" })?.id, "BRANCH_TEST");
  assert.equal(selectValidationPolicy(policies, { branchId: "B2", testId: "T1", departmentId: "D1" })?.id, "GLOBAL_TEST");
});

test("clinical scope remains more specific than a broader branch override", () => {
  const policies = [
    { ...base, id: "GLOBAL_TEST", code: "GLOBAL_TEST", scope: "TEST" as const, branchId: null, departmentId: null, testId: "T1" },
    { ...base, id: "BRANCH_DEPT", code: "BRANCH_DEPT", scope: "DEPARTMENT" as const, branchId: "B1", departmentId: "D1", testId: null, requiresMedicalValidation: true },
    { ...base, id: "BRANCH_ORG", code: "BRANCH_ORG", scope: "ORGANIZATION" as const, branchId: "B1", departmentId: null, testId: null, requiresMedicalValidation: true },
  ];

  assert.equal(selectValidationPolicy(policies, { branchId: "B1", testId: "T1", departmentId: "D1" })?.id, "GLOBAL_TEST");
});

test("policy from another branch never applies", () => {
  const policies = [
    { ...base, id: "B1_TEST", code: "B1_TEST", scope: "TEST" as const, branchId: "B1", departmentId: null, testId: "T1" },
  ];
  assert.equal(selectValidationPolicy(policies, { branchId: "B2", testId: "T1", departmentId: "D1" }), null);
});

test("default validation path requires technical review only", () => {
  const snapshot = snapshotValidationPolicy(null);
  assert.equal(snapshot.source, "DEFAULT");
  assert.equal(snapshot.requiresMedicalValidation, false);
  assert.equal(stageAfterTechnicalReview(snapshot), "COMPLETE");
});

test("medical validation policy advances technical review to medical validation", () => {
  const snapshot = snapshotValidationPolicy({
    ...base,
    id: "P1",
    code: "P1",
    scope: "TEST",
    departmentId: null,
    testId: "T1",
    requiresMedicalValidation: true,
  });
  assert.equal(stageAfterTechnicalReview(snapshot), "MEDICAL_VALIDATION");
});

test("autoverification cannot bypass required medical validation", () => {
  const snapshot = {
    ...snapshotValidationPolicy(null),
    requiresMedicalValidation: true,
  };
  assert.deepEqual(
    automatedTechnicalReviewOutcome(snapshot, { eligible: true, complete: true }),
    { resultStatus: "ENTERED", validationStage: "MEDICAL_VALIDATION", verificationComplete: false },
  );
});

test("autoverification completes only technical-only validation paths", () => {
  const snapshot = snapshotValidationPolicy(null);
  assert.deepEqual(
    automatedTechnicalReviewOutcome(snapshot, { eligible: true, complete: true }),
    { resultStatus: "VERIFIED", validationStage: "COMPLETE", verificationComplete: true },
  );
});

test("ineligible or incomplete autoverification remains in manual workflow", () => {
  const snapshot = snapshotValidationPolicy(null);
  assert.deepEqual(
    automatedTechnicalReviewOutcome(snapshot, { eligible: false, complete: true }),
    { resultStatus: "ENTERED", validationStage: "TECHNICAL_REVIEW", verificationComplete: false },
  );
  assert.deepEqual(
    automatedTechnicalReviewOutcome(snapshot, { eligible: true, complete: false }),
    { resultStatus: "DRAFT", validationStage: "ENTRY", verificationComplete: false },
  );
});

test("same reviewer is blocked unless policy explicitly allows it", () => {
  const separated = { ...snapshotValidationPolicy(null), requiresMedicalValidation: true, allowSameReviewer: false };
  const allowed = { ...separated, allowSameReviewer: true };

  assert.equal(medicalReviewerAllowed(separated, "U1", "U1"), false);
  assert.equal(medicalReviewerAllowed(separated, "U1", "U2"), true);
  assert.equal(medicalReviewerAllowed(allowed, "U1", "U1"), true);
});

test("entry is locked after technical approval while awaiting medical validation", () => {
  assert.equal(isResultEntryLockedByValidation("ENTRY"), false);
  assert.equal(isResultEntryLockedByValidation("TECHNICAL_REVIEW"), false);
  assert.equal(isResultEntryLockedByValidation("MEDICAL_VALIDATION"), true);
  assert.equal(isResultEntryLockedByValidation("COMPLETE"), true);
});
