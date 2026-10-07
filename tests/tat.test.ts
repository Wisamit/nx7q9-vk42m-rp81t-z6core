import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOrderItemTatSnapshot,
  selectBestTatPolicy,
  tatPolicyMatches,
  tatRemainingMinutes,
  tatWorkState,
  type TatPolicyCandidate,
} from "../src/lib/tat.ts";

function policy(overrides: Partial<TatPolicyCandidate> = {}): TatPolicyCandidate {
  return {
    id: "P1",
    branchId: null,
    priority: null,
    tatMinutes: 120,
    alertBeforeMinutes: 30,
    effectiveFrom: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("catalog TAT is snapshotted from ordered-at clock", () => {
  const orderedAt = new Date("2026-10-07T08:00:00.000Z");
  const snapshot = buildOrderItemTatSnapshot(90, orderedAt);

  assert.equal(snapshot.tatMinutesSnapshot, 90);
  assert.equal(snapshot.tatClockBasisSnapshot, "ORDERED_AT");
  assert.equal(snapshot.tatClockStartedAt?.toISOString(), orderedAt.toISOString());
  assert.equal(snapshot.tatDueAt?.toISOString(), "2026-10-07T09:30:00.000Z");
  assert.equal(snapshot.tatAlertAt, null);
  assert.equal(snapshot.tatPolicyId, null);
  assert.equal(snapshot.tatSnapshotSource, "CATALOG_SNAPSHOT");
});

test("missing catalog TAT remains explicitly not configured", () => {
  const snapshot = buildOrderItemTatSnapshot(null, new Date("2026-10-07T08:00:00.000Z"));
  assert.deepEqual(snapshot, {
    tatMinutesSnapshot: null,
    tatClockBasisSnapshot: null,
    tatClockStartedAt: null,
    tatDueAt: null,
    tatAlertBeforeMinutesSnapshot: null,
    tatAlertAt: null,
    tatPolicyId: null,
    tatSnapshotSource: "NOT_CONFIGURED",
  });
});

test("SLA policy snapshots alert time and immutable source identity", () => {
  const orderedAt = new Date("2026-10-07T08:00:00.000Z");
  const snapshot = buildOrderItemTatSnapshot(60, orderedAt, {
    source: "SLA_POLICY",
    policyId: "POLICY-1",
    alertBeforeMinutes: 15,
  });

  assert.equal(snapshot.tatDueAt?.toISOString(), "2026-10-07T09:00:00.000Z");
  assert.equal(snapshot.tatAlertAt?.toISOString(), "2026-10-07T08:45:00.000Z");
  assert.equal(snapshot.tatAlertBeforeMinutesSnapshot, 15);
  assert.equal(snapshot.tatPolicyId, "POLICY-1");
  assert.equal(snapshot.tatSnapshotSource, "SLA_POLICY");
});

test("invalid negative TAT is rejected", () => {
  assert.throws(
    () => buildOrderItemTatSnapshot(-1, new Date("2026-10-07T08:00:00.000Z")),
    /INVALID_TAT_MINUTES/,
  );
});

test("SLA alert cannot start before the TAT clock", () => {
  assert.throws(
    () => buildOrderItemTatSnapshot(60, new Date("2026-10-07T08:00:00.000Z"), {
      source: "SLA_POLICY",
      policyId: "P1",
      alertBeforeMinutes: 61,
    }),
    /INVALID_TAT_ALERT_BEFORE_MINUTES/,
  );
});

test("TAT policy matching fails closed for another branch or priority", () => {
  assert.equal(tatPolicyMatches(policy({ branchId: "B1" }), { branchId: "B2", priority: "ROUTINE" }), false);
  assert.equal(tatPolicyMatches(policy({ priority: "STAT" }), { branchId: "B1", priority: "ROUTINE" }), false);
  assert.equal(tatPolicyMatches(policy(), { branchId: "B1", priority: "ROUTINE" }), true);
});

test("TAT policy resolution prefers exact branch and priority then deterministic fallbacks", () => {
  const generic = policy({ id: "GENERIC", tatMinutes: 180 });
  const orgPriority = policy({ id: "ORG-STAT", priority: "STAT", tatMinutes: 90 });
  const branchDefault = policy({ id: "BRANCH", branchId: "B1", tatMinutes: 75 });
  const exact = policy({ id: "EXACT", branchId: "B1", priority: "STAT", tatMinutes: 45 });

  assert.equal(
    selectBestTatPolicy([generic, orgPriority, branchDefault, exact], { branchId: "B1", priority: "STAT" })?.id,
    "EXACT",
  );
  assert.equal(
    selectBestTatPolicy([generic, orgPriority, branchDefault], { branchId: "B1", priority: "STAT" })?.id,
    "BRANCH",
  );
  assert.equal(
    selectBestTatPolicy([generic, orgPriority], { branchId: "B1", priority: "STAT" })?.id,
    "ORG-STAT",
  );
});

test("newer effective policy wins when scope specificity is equal", () => {
  const older = policy({ id: "OLDER", branchId: "B1", effectiveFrom: new Date("2026-01-01T00:00:00.000Z") });
  const newer = policy({ id: "NEWER", branchId: "B1", effectiveFrom: new Date("2026-06-01T00:00:00.000Z") });
  assert.equal(selectBestTatPolicy([older, newer], { branchId: "B1", priority: "ROUTINE" })?.id, "NEWER");
});

test("work-state distinguishes due-soon from overdue and complete", () => {
  const dueAt = new Date("2026-10-07T10:00:00.000Z");
  const alertAt = new Date("2026-10-07T09:30:00.000Z");

  assert.equal(tatWorkState(dueAt, "IN_PROGRESS", new Date("2026-10-07T09:00:00.000Z"), alertAt), "PENDING");
  assert.equal(tatWorkState(dueAt, "IN_PROGRESS", new Date("2026-10-07T09:45:00.000Z"), alertAt), "DUE_SOON");
  assert.equal(tatWorkState(dueAt, "IN_PROGRESS", new Date("2026-10-07T10:01:00.000Z"), alertAt), "OVERDUE");
  assert.equal(tatWorkState(dueAt, "VERIFIED", new Date("2026-10-07T10:01:00.000Z"), alertAt), "COMPLETE");
  assert.equal(tatWorkState(null, "IN_PROGRESS", new Date("2026-10-07T09:00:00.000Z")), "NO_TAT");
});

test("remaining TAT rounds upward to the next minute", () => {
  const dueAt = new Date("2026-10-07T09:00:30.000Z");
  const now = new Date("2026-10-07T08:00:00.000Z");
  assert.equal(tatRemainingMinutes(dueAt, now), 61);
});
