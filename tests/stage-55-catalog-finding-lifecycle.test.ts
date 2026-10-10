import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { catalogDriftObservationToken } from "../src/lib/catalog-drift-triage.ts";
import { resolveFindingLifecycle, triageResubmission } from "../src/lib/catalog-finding-lifecycle.ts";

const secret = "Stage55-only-testing-key-never-deploy";
const checksum = "b".repeat(64);
const source = { unitPrice: "123.4500", currency: "AED", effectiveFrom: "2026-10-01" };
const originalLive = { unitPrice: "125.0000", currency: "AED", effectiveFrom: "2026-10-01" };
const observed = catalogDriftObservationToken(secret, checksum, 4, "PRICE_LIST_ITEM", source, originalLive);

test("Stage 55 lifecycle: unactioned, pending and independent outcomes remain non-approval", () => {
  assert.deepEqual(resolveFindingLifecycle(null), {
    status: "UNFLAGGED", canRefer: true, latestDisposition: null,
    awaitingFreshEvidence: false,
  });
  const pending = { evidenceToken: observed, currentObservation: observed, decision: null };
  assert.deepEqual(resolveFindingLifecycle(pending), {
    status: "AWAITING_EXPERT", canRefer: false, latestDisposition: null,
    awaitingFreshEvidence: false,
  });
  assert.equal(triageResubmission(pending, "SOURCE_VALUE_CHANGED", "SOURCE_VALUE_CHANGED"),
    "ALREADY_FLAGGED");
  assert.equal(triageResubmission(pending, "FOLLOW_UP_REQUIRED", "SOURCE_VALUE_CHANGED"),
    "ALREADY_PENDING");

  for (const [decision, expected] of [
    ["CONFIRM_FINDING", "EXPERT_CONFIRMED"],
    ["RETURN_FOR_CORRECTION", "RETURNED_FOR_CORRECTION"],
  ] as const) {
    const same = { ...pending, decision };
    assert.deepEqual(resolveFindingLifecycle(same), {
      status: expected, canRefer: false, latestDisposition: decision,
      awaitingFreshEvidence: false,
    });
    assert.equal(triageResubmission(same, "FOLLOW_UP_REQUIRED", "SOURCE_VALUE_CHANGED"),
      "DECIDED");
  }
});

test("Stage 55 lifecycle: minute changes to financial/clinical data invalidate review history", () => {
  const changedAmount = catalogDriftObservationToken(secret, checksum, 4,
    "PRICE_LIST_ITEM", source, { ...originalLive, unitPrice: "125.0001" });
  const changedCurrency = catalogDriftObservationToken(secret, checksum, 4,
    "PRICE_LIST_ITEM", source, { ...originalLive, currency: "USD" });
  const changedDate = catalogDriftObservationToken(secret, checksum, 4,
    "PRICE_LIST_ITEM", source, { ...originalLive, effectiveFrom: "2026-10-02" });
  for (const newer of [changedAmount, changedCurrency, changedDate]) {
    const stale = { evidenceToken: observed, currentObservation: newer,
      decision: "CONFIRM_FINDING" };
    assert.deepEqual(resolveFindingLifecycle(stale), {
      status: "STALE_REVIEW_REQUIRED", canRefer: true,
      latestDisposition: "CONFIRM_FINDING", awaitingFreshEvidence: true,
    });
    assert.equal(triageResubmission(stale, "SOURCE_VALUE_CHANGED",
      "SOURCE_VALUE_CHANGED"), "NEW_EVIDENCE");
    assert.equal(resolveFindingLifecycle({
      evidenceToken: observed, currentObservation: newer,
      decision: "RETURN_FOR_CORRECTION",
    }).status, "STALE_REVIEW_REQUIRED");
  }
  const rangeSource = { lowValue: "20.000000", criticalLow: "12.000000" };
  const rangeLive = { ...rangeSource };
  const token = catalogDriftObservationToken(secret, checksum, 5,
    "REFERENCE_INTERVAL", rangeSource, rangeLive);
  const newRangeToken = catalogDriftObservationToken(secret, checksum, 5,
    "REFERENCE_INTERVAL", rangeSource,
    { ...rangeLive, criticalLow: "13.000000" });
  assert.equal(resolveFindingLifecycle({
    evidenceToken: token, currentObservation: newRangeToken, decision: null,
  }).status, "STALE_REVIEW_REQUIRED");
  assert.equal(resolveFindingLifecycle({
    evidenceToken: "invalid", currentObservation: token,
    decision: "CONFIRM_FINDING",
  }).status, "STALE_REVIEW_REQUIRED");
});

test("Stage 55 route uses newest audit flag and decision for each scoped row", () => {
  const route = readFileSync("src/app/api/catalog/imports/[id]/bundle-drift/route.ts", "utf8");
  const ui = readFileSync("src/components/catalog-bundle-drift-review.tsx", "utf8");
  assert.match(route, /orderBy: \[\{ occurredAt: "desc" \}, \{ id: "desc" \}\]/);
  assert.match(route, /const latestDecisions = new Map/);
  assert.match(route, /review_history_limit_exceeded/);
  assert.match(route, /review_decision_integrity_error/);
  assert.match(route, /resolveFindingLifecycle\(flag \? \{/);
  assert.match(route, /triageResubmission\(existingFlag \? \{/);
  assert.match(route, /triage_already_pending_expert/);
  assert.match(route, /triage_decided_new_observation_required/);
  assert.match(route, /approved: false, activated: false/);
  assert.match(route, /isolationLevel: "RepeatableRead"/);
  assert.match(route, /createdByUserId: session\.user\.id/);
  assert.match(route, /clinicalImportTestWhere\(liveScope\)/);
  assert.doesNotMatch(route, /tx\.(?:labTest|testComponent|unit|referenceInterval|priceList|priceListItem|catalogImportRow)\.(?:create|update|upsert|delete)/);
  assert.match(ui, /STALE_REVIEW_REQUIRED/);
  assert.match(ui, /row\.finding\.canRefer/);
  assert.match(ui, /Review lifecycle/);
});
