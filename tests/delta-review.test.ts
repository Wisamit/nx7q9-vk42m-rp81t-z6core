import test from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "../generated/prisma/client.ts";
import { deltaReviewRequired, deltaReviewSnapshot } from "../src/lib/delta-review.ts";

function value(overrides: Partial<{
  componentCodeSnapshot: string;
  componentNameEnSnapshot: string;
  componentNameArSnapshot: string | null;
  valueNumeric: Prisma.Decimal | null;
  deltaEvaluation: "NOT_CONFIGURED" | "NO_PREVIOUS_RESULT" | "WITHIN_LIMIT" | "EXCEEDED";
  previousValueSnapshot: Prisma.Decimal | null;
  previousResultAtSnapshot: Date | null;
  deltaAbsoluteSnapshot: Prisma.Decimal | null;
  deltaPercentSnapshot: Prisma.Decimal | null;
  deltaAbsoluteLimitSnapshot: Prisma.Decimal | null;
  deltaPercentLimitSnapshot: Prisma.Decimal | null;
  deltaRuleId: string | null;
  deltaLookbackDaysSnapshot: number | null;
}> = {}) {
  return {
    componentCodeSnapshot: "HGB",
    componentNameEnSnapshot: "Hemoglobin",
    componentNameArSnapshot: "الهيموغلوبين",
    valueNumeric: new Prisma.Decimal("15.0"),
    deltaEvaluation: "EXCEEDED" as const,
    previousValueSnapshot: new Prisma.Decimal("10.0"),
    previousResultAtSnapshot: new Date("2026-09-01T08:00:00.000Z"),
    deltaAbsoluteSnapshot: new Prisma.Decimal("5.0"),
    deltaPercentSnapshot: new Prisma.Decimal("50.0"),
    deltaAbsoluteLimitSnapshot: new Prisma.Decimal("3.0"),
    deltaPercentLimitSnapshot: new Prisma.Decimal("25.0"),
    deltaRuleId: "RULE-1",
    deltaLookbackDaysSnapshot: 90,
    ...overrides,
  };
}

test("delta review is required only for an exceeded numeric result", () => {
  assert.equal(deltaReviewRequired(value()), true);
  assert.equal(deltaReviewRequired(value({ deltaEvaluation: "WITHIN_LIMIT" })), false);
  assert.equal(deltaReviewRequired(value({ valueNumeric: null })), false);
});

test("delta review snapshot preserves the exact rule evidence and analytical context", () => {
  const snapshot = deltaReviewSnapshot(value(), {
    performingBranchId: "BRANCH-1",
    methodId: "METHOD-1",
  });

  assert.ok(snapshot);
  assert.equal(snapshot?.deltaRuleId, "RULE-1");
  assert.equal(snapshot?.currentValueSnapshot.toString(), "15");
  assert.equal(snapshot?.previousValueSnapshot?.toString(), "10");
  assert.equal(snapshot?.deltaAbsoluteSnapshot?.toString(), "5");
  assert.equal(snapshot?.deltaPercentSnapshot?.toString(), "50");
  assert.equal(snapshot?.absoluteLimitSnapshot?.toString(), "3");
  assert.equal(snapshot?.percentLimitSnapshot?.toString(), "25");
  assert.equal(snapshot?.lookbackDaysSnapshot, 90);
  assert.equal(snapshot?.performingBranchIdSnapshot, "BRANCH-1");
  assert.equal(snapshot?.methodIdSnapshot, "METHOD-1");
});

test("non-exceeded values cannot create a delta review snapshot", () => {
  assert.equal(deltaReviewSnapshot(value({ deltaEvaluation: "NO_PREVIOUS_RESULT" }), {
    performingBranchId: "BRANCH-1",
    methodId: null,
  }), null);
});
