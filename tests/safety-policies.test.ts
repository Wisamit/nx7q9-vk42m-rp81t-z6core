import test from "node:test";
import assert from "node:assert/strict";
import {
  amendmentEligibility,
  branchScopeAllows,
  departmentScopeAllows,
  releaseEligibility,
  specimenActionError,
} from "../src/lib/clinical-safety.ts";
import { comparePricingCandidates } from "../src/lib/pricing-policy.ts";
import { approverCanAuthorize, discountApprovalMode, effectiveDiscountLimit } from "../src/lib/discount-policy.ts";

test("specimen collection is only allowed from PLANNED with specimen type configured", () => {
  assert.equal(specimenActionError({ status: "PLANNED", action: "COLLECT", specimenTypeConfigured: true }), null);
  assert.equal(specimenActionError({ status: "COLLECTED", action: "COLLECT", specimenTypeConfigured: true }), "specimen_not_collectable");
  assert.equal(specimenActionError({ status: "PLANNED", action: "COLLECT", specimenTypeConfigured: false }), "specimen_type_required_before_collection");
});

test("specimen receive accepts COLLECTED and IN_TRANSIT only", () => {
  assert.equal(specimenActionError({ status: "COLLECTED", action: "RECEIVE", specimenTypeConfigured: true }), null);
  assert.equal(specimenActionError({ status: "IN_TRANSIT", action: "RECEIVE", specimenTypeConfigured: true }), null);
  assert.equal(specimenActionError({ status: "PLANNED", action: "RECEIVE", specimenTypeConfigured: true }), "specimen_not_receivable");
  assert.equal(specimenActionError({ status: "REJECTED", action: "RECEIVE", specimenTypeConfigured: true }), "specimen_not_receivable");
});

test("specimen rejection is limited to collected or received samples", () => {
  assert.equal(specimenActionError({ status: "COLLECTED", action: "REJECT", specimenTypeConfigured: true }), null);
  assert.equal(specimenActionError({ status: "RECEIVED", action: "REJECT", specimenTypeConfigured: true }), null);
  assert.equal(specimenActionError({ status: "IN_PROCESS", action: "REJECT", specimenTypeConfigured: true }), "specimen_not_rejectable");
});

test("result release requires VERIFIED status", () => {
  assert.deepEqual(releaseEligibility({
    resultStatus: "DRAFT",
    qcBlocking: false,
    criticalCount: 0,
    criticalEventStatus: null,
  }), { allowed: false, error: "result_not_releasable" });
});

test("QC blocking state prevents result release", () => {
  assert.deepEqual(releaseEligibility({
    resultStatus: "VERIFIED",
    qcBlocking: true,
    criticalCount: 0,
    criticalEventStatus: null,
  }), { allowed: false, error: "qc_release_blocked" });
});

test("critical results cannot release before acknowledgement", () => {
  assert.deepEqual(releaseEligibility({
    resultStatus: "VERIFIED",
    qcBlocking: false,
    criticalCount: 1,
    criticalEventStatus: "OPEN",
  }), { allowed: false, error: "critical_acknowledgement_required" });
});

test("verified non-critical result can release when QC does not block", () => {
  assert.deepEqual(releaseEligibility({
    resultStatus: "VERIFIED",
    qcBlocking: false,
    criticalCount: 0,
    criticalEventStatus: null,
  }), { allowed: true, error: null });
});

test("acknowledged critical result can release when other gates pass", () => {
  assert.deepEqual(releaseEligibility({
    resultStatus: "VERIFIED",
    qcBlocking: false,
    criticalCount: 2,
    criticalEventStatus: "ACKNOWLEDGED",
  }), { allowed: true, error: null });
});

test("only released results can enter amendment workflow", () => {
  assert.deepEqual(amendmentEligibility({
    resultStatus: "VERIFIED",
    hasMicrobiologySnapshot: false,
    newerResultExists: false,
  }), { allowed: false, error: "only_released_results_can_be_amended" });
});

test("microbiology results require their dedicated amendment workflow", () => {
  assert.deepEqual(amendmentEligibility({
    resultStatus: "RELEASED",
    hasMicrobiologySnapshot: true,
    newerResultExists: false,
  }), { allowed: false, error: "microbiology_requires_dedicated_amendment_workflow" });
});

test("released result cannot spawn another amendment when a newer active version exists", () => {
  assert.deepEqual(amendmentEligibility({
    resultStatus: "RELEASED",
    hasMicrobiologySnapshot: false,
    newerResultExists: true,
  }), { allowed: false, error: "newer_result_version_already_exists" });
});

test("released result can start a versioned amendment when no newer version exists", () => {
  assert.deepEqual(amendmentEligibility({
    resultStatus: "RELEASED",
    hasMicrobiologySnapshot: false,
    newerResultExists: false,
  }), { allowed: true, error: null });
});

test("branch scope rejects missing or unauthorized branches", () => {
  assert.equal(branchScopeAllows(["branch-a", "branch-b"], "branch-a"), true);
  assert.equal(branchScopeAllows(["branch-a", "branch-b"], "branch-c"), false);
  assert.equal(branchScopeAllows(["branch-a"], null), false);
});

test("department scope is unrestricted when no explicit departments are assigned", () => {
  assert.equal(departmentScopeAllows([], "hematology"), true);
  assert.equal(departmentScopeAllows([], null), true);
});

test("department scope restricts access once explicit departments are assigned", () => {
  assert.equal(departmentScopeAllows(["hematology", "chemistry"], "hematology"), true);
  assert.equal(departmentScopeAllows(["hematology", "chemistry"], "microbiology"), false);
  assert.equal(departmentScopeAllows(["hematology"], null), false);
});

test("pricing precedence is CONTRACT > CLIENT > SOURCE > BRANCH > ORGANIZATION", () => {
  const candidates = [
    { scopeType: "ORGANIZATION" as const, priority: 999, effectiveFrom: new Date("2026-01-01") },
    { scopeType: "BRANCH" as const, priority: 999, effectiveFrom: new Date("2026-01-01") },
    { scopeType: "SOURCE" as const, priority: 1, effectiveFrom: new Date("2026-01-01") },
    { scopeType: "CLIENT" as const, priority: 1, effectiveFrom: new Date("2026-01-01") },
    { scopeType: "CONTRACT" as const, priority: 0, effectiveFrom: new Date("2025-01-01") },
  ].sort(comparePricingCandidates);

  assert.deepEqual(candidates.map(item => item.scopeType), ["CONTRACT", "CLIENT", "SOURCE", "BRANCH", "ORGANIZATION"]);
});

test("pricing priority wins within the same scope", () => {
  const candidates = [
    { scopeType: "BRANCH" as const, priority: 10, effectiveFrom: new Date("2026-09-01") },
    { scopeType: "BRANCH" as const, priority: 20, effectiveFrom: new Date("2026-01-01") },
  ].sort(comparePricingCandidates);

  assert.equal(candidates[0].priority, 20);
});

test("newer effective date wins when scope and priority are equal", () => {
  const candidates = [
    { scopeType: "CLIENT" as const, priority: 10, effectiveFrom: new Date("2026-01-01") },
    { scopeType: "CLIENT" as const, priority: 10, effectiveFrom: new Date("2026-10-01") },
  ].sort(comparePricingCandidates);

  assert.equal(candidates[0].effectiveFrom.toISOString().slice(0, 10), "2026-10-01");
});


test("source pricing priority wins within the source scope", () => {
  const candidates = [
    { scopeType: "SOURCE" as const, priority: 10, effectiveFrom: new Date("2026-09-01") },
    { scopeType: "SOURCE" as const, priority: 20, effectiveFrom: new Date("2026-01-01") },
  ].sort(comparePricingCandidates);

  assert.equal(candidates[0].priority, 20);
});


test("user discount override takes precedence over assigned role limits", () => {
  assert.equal(effectiveDiscountLimit({
    userOverride: 7.5,
    roleLimits: [5, 20],
  }), 7.5);
});

test("highest active role discount limit is used when user has no override", () => {
  assert.equal(effectiveDiscountLimit({
    userOverride: null,
    roleLimits: [5, 12.5, 10],
  }), 12.5);
});

test("discount above requester limit requires approver re-authentication", () => {
  assert.equal(discountApprovalMode({ requestedPercent: 6, requesterLimitPercent: 5 }), "APPROVER_REAUTH");
  assert.equal(discountApprovalMode({ requestedPercent: 5, requesterLimitPercent: 5 }), "SELF_LIMIT");
  assert.equal(discountApprovalMode({ requestedPercent: 0, requesterLimitPercent: 0 }), "NONE");
});

test("discount approver must have permission, branch access and sufficient limit", () => {
  assert.equal(approverCanAuthorize({
    requestedPercent: 15,
    approverLimitPercent: 20,
    hasApprovalPermission: true,
    branchAllowed: true,
  }), true);
  assert.equal(approverCanAuthorize({
    requestedPercent: 15,
    approverLimitPercent: 10,
    hasApprovalPermission: true,
    branchAllowed: true,
  }), false);
  assert.equal(approverCanAuthorize({
    requestedPercent: 15,
    approverLimitPercent: 20,
    hasApprovalPermission: false,
    branchAllowed: true,
  }), false);
  assert.equal(approverCanAuthorize({
    requestedPercent: 15,
    approverLimitPercent: 20,
    hasApprovalPermission: true,
    branchAllowed: false,
  }), false);
});
