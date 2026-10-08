import test from "node:test";
import assert from "node:assert/strict";
import {
  planTatPolicyApproval,
  sameTatPolicyScope,
  tatPolicyClinicallyUsable,
  tatPolicyWindowsOverlap,
} from "../src/lib/tat-policy-governance.ts";

function policy(overrides: Partial<{
  id: string;
  testId: string;
  branchId: string | null;
  priority: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}> = {}) {
  return {
    id: "P1",
    testId: "T1",
    branchId: null,
    priority: null,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    ...overrides,
  };
}

test("TAT policy clinical scope is test + branch + priority", () => {
  const base = policy();
  assert.equal(sameTatPolicyScope(base, policy({ id: "P2" })), true);
  assert.equal(sameTatPolicyScope(base, policy({ id: "P2", branchId: "B1" })), false);
  assert.equal(sameTatPolicyScope(base, policy({ id: "P2", priority: "STAT" })), false);
  assert.equal(sameTatPolicyScope(base, policy({ id: "P2", testId: "T2" })), false);
});

test("TAT policy effective windows detect open-ended overlap", () => {
  assert.equal(tatPolicyWindowsOverlap(
    policy({ effectiveFrom: new Date("2026-01-01"), effectiveTo: null }),
    policy({ effectiveFrom: new Date("2026-06-01"), effectiveTo: null }),
  ), true);
  assert.equal(tatPolicyWindowsOverlap(
    policy({ effectiveFrom: new Date("2026-01-01"), effectiveTo: new Date("2026-02-01") }),
    policy({ effectiveFrom: new Date("2026-03-01"), effectiveTo: null }),
  ), false);
});

test("later TAT version safely closes an earlier approved predecessor", () => {
  const draft = policy({ id: "NEW", effectiveFrom: new Date("2026-10-01") });
  const plan = planTatPolicyApproval(draft, [
    policy({ id: "OLD", effectiveFrom: new Date("2026-01-01") }),
  ]);
  assert.deepEqual(plan, { predecessorsToClose: ["OLD"], conflicts: [] });
});

test("same or later overlapping TAT policy version is blocked", () => {
  const draft = policy({ id: "DRAFT", effectiveFrom: new Date("2026-10-01") });
  const plan = planTatPolicyApproval(draft, [
    policy({ id: "SAME", effectiveFrom: new Date("2026-10-01") }),
    policy({ id: "FUTURE", effectiveFrom: new Date("2026-11-01") }),
  ]);
  assert.deepEqual(plan.predecessorsToClose, []);
  assert.deepEqual(plan.conflicts, ["SAME", "FUTURE"]);
});

test("only active approved TAT policies with approval evidence are clinically usable", () => {
  assert.equal(tatPolicyClinicallyUsable({ status: "ACTIVE", approvalStatus: "APPROVED", approvedAt: new Date() }), true);
  assert.equal(tatPolicyClinicallyUsable({ status: "ACTIVE", approvalStatus: "DRAFT", approvedAt: null }), false);
  assert.equal(tatPolicyClinicallyUsable({ status: "INACTIVE", approvalStatus: "APPROVED", approvedAt: new Date() }), false);
  assert.equal(tatPolicyClinicallyUsable({ status: "ACTIVE", approvalStatus: "APPROVED", approvedAt: null }), false);
});
