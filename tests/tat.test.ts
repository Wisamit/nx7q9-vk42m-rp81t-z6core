import test from "node:test";
import assert from "node:assert/strict";
import { buildOrderItemTatSnapshot, tatRemainingMinutes, tatWorkState } from "../src/lib/tat.ts";

test("catalog TAT is snapshotted from ordered-at clock", () => {
  const orderedAt = new Date("2026-10-07T08:00:00.000Z");
  const snapshot = buildOrderItemTatSnapshot(90, orderedAt);

  assert.equal(snapshot.tatMinutesSnapshot, 90);
  assert.equal(snapshot.tatClockBasisSnapshot, "ORDERED_AT");
  assert.equal(snapshot.tatClockStartedAt?.toISOString(), orderedAt.toISOString());
  assert.equal(snapshot.tatDueAt?.toISOString(), "2026-10-07T09:30:00.000Z");
  assert.equal(snapshot.tatSnapshotSource, "CATALOG_SNAPSHOT");
});

test("missing catalog TAT remains explicitly not configured", () => {
  const snapshot = buildOrderItemTatSnapshot(null, new Date("2026-10-07T08:00:00.000Z"));
  assert.deepEqual(snapshot, {
    tatMinutesSnapshot: null,
    tatClockBasisSnapshot: null,
    tatClockStartedAt: null,
    tatDueAt: null,
    tatSnapshotSource: "NOT_CONFIGURED",
  });
});

test("invalid negative TAT is rejected", () => {
  assert.throws(
    () => buildOrderItemTatSnapshot(-1, new Date("2026-10-07T08:00:00.000Z")),
    /INVALID_TAT_MINUTES/,
  );
});

test("work-state does not classify completed items as overdue", () => {
  const dueAt = new Date("2026-10-07T08:00:00.000Z");
  const now = new Date("2026-10-07T09:00:00.000Z");

  assert.equal(tatWorkState(dueAt, "IN_PROGRESS", now), "OVERDUE");
  assert.equal(tatWorkState(dueAt, "VERIFIED", now), "COMPLETE");
  assert.equal(tatWorkState(null, "IN_PROGRESS", now), "NO_TAT");
});

test("remaining TAT rounds upward to the next minute", () => {
  const dueAt = new Date("2026-10-07T09:00:30.000Z");
  const now = new Date("2026-10-07T08:00:00.000Z");
  assert.equal(tatRemainingMinutes(dueAt, now), 61);
});
