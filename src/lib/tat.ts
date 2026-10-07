export type TatSnapshotSource = "CATALOG_SNAPSHOT" | "NOT_CONFIGURED" | "MIGRATED_BASELINE";
export type TatClockBasis = "ORDERED_AT";

export type OrderItemTatSnapshot = {
  tatMinutesSnapshot: number | null;
  tatClockBasisSnapshot: TatClockBasis | null;
  tatClockStartedAt: Date | null;
  tatDueAt: Date | null;
  tatSnapshotSource: TatSnapshotSource;
};

export function buildOrderItemTatSnapshot(
  tatMinutes: number | null | undefined,
  orderedAt: Date,
): OrderItemTatSnapshot {
  if (tatMinutes == null) {
    return {
      tatMinutesSnapshot: null,
      tatClockBasisSnapshot: null,
      tatClockStartedAt: null,
      tatDueAt: null,
      tatSnapshotSource: "NOT_CONFIGURED",
    };
  }

  if (!Number.isInteger(tatMinutes) || tatMinutes < 0 || tatMinutes > 5_256_000) {
    throw new Error("INVALID_TAT_MINUTES");
  }

  return {
    tatMinutesSnapshot: tatMinutes,
    tatClockBasisSnapshot: "ORDERED_AT",
    tatClockStartedAt: orderedAt,
    tatDueAt: new Date(orderedAt.getTime() + tatMinutes * 60_000),
    tatSnapshotSource: "CATALOG_SNAPSHOT",
  };
}

export type TatWorkState = "NO_TAT" | "PENDING" | "OVERDUE" | "COMPLETE";

export function tatWorkState(
  dueAt: Date | null,
  itemStatus: string,
  now: Date,
): TatWorkState {
  if (["VERIFIED", "CANCELLED"].includes(itemStatus)) return "COMPLETE";
  if (!dueAt) return "NO_TAT";
  return dueAt.getTime() < now.getTime() ? "OVERDUE" : "PENDING";
}

export function tatRemainingMinutes(dueAt: Date | null, now: Date) {
  if (!dueAt) return null;
  return Math.ceil((dueAt.getTime() - now.getTime()) / 60_000);
}
