import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  medicalApprovalEvidenceError,
  snapshotValidationPolicy,
} from "../src/lib/result-validation.ts";

const t0 = new Date("2026-10-09T08:00:00.000Z");
const configured = snapshotValidationPolicy({
  id: "P1", code: "MEDICAL-REQ", nameEn: "Medical validation required", nameAr: null,
  scope: "TEST", branchId: "B1", departmentId: null, testId: "T1",
  requiresMedicalValidation: true, allowSameReviewer: false,
  effectiveFrom: new Date("2026-01-01T00:00:00.000Z"), effectiveTo: null,
});
const review = {
  stage: "TECHNICAL_REVIEW", outcome: "APPROVED",
  reviewerUserId: "TECH", automated: false, reviewedAt: t0, policySnapshot: configured,
};
const base = {
  policySnapshot: configured as unknown,
  performingBranchId: "B1", testId: "T1", departmentId: "D1",
  technicalReviewedByUserId: "TECH",
  technicalReviewedAt: t0,
  autoVerified: false,
  technicalReview: review,
  candidateUserId: "MEDICAL",
};

test("medical approval requires the exact manual technical approval record", () => {
  assert.equal(medicalApprovalEvidenceError(base), null);
  assert.equal(medicalApprovalEvidenceError({ ...base, candidateUserId: "TECH" }),
    "medical_validator_must_differ_from_technical_reviewer");
  const sameReviewerPolicy = { ...configured, allowSameReviewer: true };
  assert.equal(medicalApprovalEvidenceError({
    ...base, policySnapshot: sameReviewerPolicy,
    technicalReview: { ...review, policySnapshot: sameReviewerPolicy }, candidateUserId: "TECH",
  }), null);
  assert.equal(medicalApprovalEvidenceError({
    ...base, policySnapshot: sameReviewerPolicy, candidateUserId: "TECH",
  }), "technical_review_evidence_missing");
  for (const bad of [
    null,
    { ...review, reviewedAt: new Date("2026-10-08") },
    { ...review, outcome: "RETURNED" },
    { ...review, reviewerUserId: "ANOTHER" },
    { ...review, stage: "MEDICAL_VALIDATION" },
    { ...review, policySnapshot: { ...configured, policyId: "OTHER" } },
  ]) assert.equal(medicalApprovalEvidenceError({ ...base, technicalReview: bad }),
    "technical_review_evidence_missing");
});

test("automated approval needs authentic automated technical review evidence", () => {
  const automated = { ...base, autoVerified: true, technicalReviewedByUserId: null,
    technicalReview: { ...review, automated: true, reviewerUserId: null } };
  assert.equal(medicalApprovalEvidenceError(automated), null);
  assert.equal(medicalApprovalEvidenceError({ ...automated, autoVerified: false }),
    "technical_review_evidence_missing");
  assert.equal(medicalApprovalEvidenceError({
    ...automated, technicalReview: { ...automated.technicalReview, reviewerUserId: "FAKE" },
  }), "technical_review_evidence_missing");
  assert.equal(medicalApprovalEvidenceError({
    ...base, technicalReviewedByUserId: null,
  }), "technical_review_evidence_missing");
});

test("missing, malformed, migrated or wrong-scoped policy snapshots fail closed", () => {
  for (const policySnapshot of [
    null, {}, [], snapshotValidationPolicy(null),
    { source: "MIGRATED_BASELINE", requiresMedicalValidation: true, allowSameReviewer: true },
    { ...configured, requiresMedicalValidation: "true" },
    { ...configured, allowSameReviewer: "false" },
    { ...configured, policyId: null },
    { ...configured, branchId: "B2" },
    { ...configured, testId: "T2" },
    { ...configured, scope: "DEPARTMENT", departmentId: "D2", testId: null },
  ]) {
    assert.equal(medicalApprovalEvidenceError({ ...base, policySnapshot }),
      "medical_validation_policy_snapshot_invalid");
  }
  const departmentPolicy = { ...configured, scope: "DEPARTMENT" as const, testId: null, departmentId: "D1" };
  assert.equal(medicalApprovalEvidenceError({
    ...base, policySnapshot: departmentPolicy,
    technicalReview: { ...review, policySnapshot: departmentPolicy },
  }), null);
  const orgPolicy = { ...configured, scope: "ORGANIZATION" as const, testId: null, departmentId: null };
  assert.equal(medicalApprovalEvidenceError({
    ...base, policySnapshot: orgPolicy,
    technicalReview: { ...review, policySnapshot: orgPolicy },
  }), null);
});

test("medical route checks evidence after the recovery RETURN action and before QC/commit", () => {
  const s = readFileSync(new URL("../src/app/api/results/[id]/medical-validate/route.ts", import.meta.url), "utf8");
  assert.ok(s.includes('where: { stage: "TECHNICAL_REVIEW" }'));
  assert.ok(s.includes("orderBy: [{ reviewedAt: \"desc\" }, { id: \"desc\" }]"));
  assert.ok(s.includes("medicalApprovalEvidenceError({"));
  assert.ok(s.indexOf("medicalApprovalEvidenceError({") < s.indexOf("const qcGate ="));
  assert.ok(s.indexOf("medicalApprovalEvidenceError({") > s.indexOf('if (action === "RETURN")'));
  assert.ok(s.includes("technicalReview: result.validationReviews[0] || null"));
  assert.ok(s.includes("updatedAt: result.updatedAt"));
  assert.ok(s.includes("validationSpecimenCustodyError"));
});
