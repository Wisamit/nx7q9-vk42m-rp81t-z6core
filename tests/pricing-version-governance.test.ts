import test from "node:test";
import assert from "node:assert/strict";
import {
  effectivePriceRevisions,
  planNextPriceRevision,
} from "../src/lib/pricing-version-governance.ts";

function revision(overrides: Partial<{
  id: string;
  status: "ACTIVE" | "INACTIVE";
  effectiveFrom: Date;
  effectiveTo: Date | null;
}> = {}) {
  return {
    id: "R1",
    status: "ACTIVE" as const,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    effectiveTo: null,
    ...overrides,
  };
}

test("later price revision closes an overlapping active predecessor immediately before the new start", () => {
  const nextStart = new Date("2026-06-01T00:00:00.000Z");
  const plan = planNextPriceRevision([revision()], nextStart);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.predecessorIdsToClose, ["R1"]);
  assert.equal(plan.predecessorCloseAt.toISOString(), "2026-05-31T23:59:59.999Z");
});

test("later price revision preserves a deliberate historical gap", () => {
  const plan = planNextPriceRevision([
    revision({ effectiveTo: new Date("2026-03-31T23:59:59.999Z") }),
  ], new Date("2026-06-01T00:00:00.000Z"));
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.predecessorIdsToClose, []);
});

test("same-date and backdated revisions are blocked even if the latest historical record is inactive", () => {
  const existing = [
    revision({ id: "R1", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") }),
    revision({
      id: "R2",
      status: "INACTIVE",
      effectiveFrom: new Date("2026-06-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-07-01T00:00:00.000Z"),
    }),
  ];

  for (const start of [
    new Date("2026-06-01T00:00:00.000Z"),
    new Date("2026-05-01T00:00:00.000Z"),
  ]) {
    const plan = planNextPriceRevision(existing, start);
    assert.equal(plan.ok, false);
    if (plan.ok) continue;
    assert.equal(plan.error, "PRICE_REVISION_MUST_START_AFTER_LATEST");
    assert.equal(plan.latestRevisionId, "R2");
  }
});

test("new revision closes every active predecessor that still overlaps its start", () => {
  const plan = planNextPriceRevision([
    revision({ id: "OLD1", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") }),
    revision({ id: "OLD2", effectiveFrom: new Date("2026-03-01T00:00:00.000Z") }),
  ], new Date("2026-06-01T00:00:00.000Z"));

  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.predecessorIdsToClose, ["OLD1", "OLD2"]);
});

test("effective revision detection exposes ambiguity instead of hiding it", () => {
  const at = new Date("2026-04-01T00:00:00.000Z");
  const matches = effectivePriceRevisions([
    revision({ id: "R1" }),
    revision({ id: "R2", effectiveFrom: new Date("2026-03-01T00:00:00.000Z") }),
    revision({ id: "R3", status: "INACTIVE", effectiveFrom: new Date("2026-02-01T00:00:00.000Z") }),
  ], at);

  assert.deepEqual(matches.map(item => item.id), ["R1", "R2"]);
});


import { comparePricingCandidates, type PricingScopeType } from "../src/lib/pricing-policy.ts";

function pricingCandidate(scopeType: PricingScopeType, priority = 0, effectiveFrom = "2026-01-01T00:00:00.000Z") {
  return { scopeType, priority, effectiveFrom: new Date(effectiveFrom) };
}

test("pricing precedence keeps contract above referrer and referrer above client", () => {
  const rows = [
    pricingCandidate("ORGANIZATION"),
    pricingCandidate("BRANCH"),
    pricingCandidate("SOURCE"),
    pricingCandidate("CLIENT"),
    pricingCandidate("REFERRER"),
    pricingCandidate("CONTRACT"),
  ].sort(comparePricingCandidates);

  assert.deepEqual(rows.map(row => row.scopeType), [
    "CONTRACT",
    "REFERRER",
    "CLIENT",
    "SOURCE",
    "BRANCH",
    "ORGANIZATION",
  ]);
});
