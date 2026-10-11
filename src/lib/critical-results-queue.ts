import type { Prisma } from "../../generated/prisma/client";

export const CRITICAL_QUEUE_PAGE_SIZE = 50;

export type CriticalQueueFilter = "all" | "overdue";

export type CriticalQueuePosition = {
  id: string;
  acknowledgementDueAt: Date | null;
  detectedAt: Date;
};

export function criticalQueueFilter(value: string | undefined): CriticalQueueFilter {
  return value === "overdue" ? "overdue" : "all";
}

export function encodeCriticalQueueCursor(
  position: CriticalQueuePosition,
  filter: CriticalQueueFilter,
): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    filter,
    id: position.id,
    due: position.acknowledgementDueAt?.toISOString() ?? null,
    detected: position.detectedAt.toISOString(),
  })).toString("base64url");
}

/**
 * Cursors only determine the starting position, never permissions or scope.
 * Reject malformed or cross-filter cursors rather than trusting their contents.
 */
export function decodeCriticalQueueCursor(
  token: string | undefined,
  filter: CriticalQueueFilter,
): CriticalQueuePosition | null {
  if (!token || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return null;
    const raw = data as Record<string, unknown>;
    if (raw.v !== 1 || raw.filter !== filter ||
      typeof raw.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw.id) ||
      typeof raw.detected !== "string" ||
      (raw.due !== null && typeof raw.due !== "string")) return null;
    const detectedAt = new Date(raw.detected);
    const acknowledgementDueAt = raw.due === null ? null : new Date(raw.due as string);
    if (!Number.isFinite(detectedAt.getTime()) ||
      detectedAt.toISOString() !== raw.detected ||
      (acknowledgementDueAt !== null && (
        !Number.isFinite(acknowledgementDueAt.getTime()) ||
        acknowledgementDueAt.toISOString() !== raw.due
      )) || (filter === "overdue" && acknowledgementDueAt === null)) return null;
    return { id: raw.id, detectedAt, acknowledgementDueAt };
  } catch {
    return null;
  }
}

/** Stable keyset with overdue/due items before unscheduled items (NULL last). */
export function criticalQueueAfterWhere(
  cursor: CriticalQueuePosition | null,
): Prisma.CriticalResultEventWhereInput {
  if (!cursor) return {};
  if (cursor.acknowledgementDueAt === null) {
    return { OR: [
      { acknowledgementDueAt: null, detectedAt: { gt: cursor.detectedAt } },
      { acknowledgementDueAt: null, detectedAt: cursor.detectedAt, id: { gt: cursor.id } },
    ] };
  }
  return { OR: [
    { acknowledgementDueAt: { gt: cursor.acknowledgementDueAt } },
    { acknowledgementDueAt: cursor.acknowledgementDueAt, detectedAt: { gt: cursor.detectedAt } },
    { acknowledgementDueAt: cursor.acknowledgementDueAt, detectedAt: cursor.detectedAt, id: { gt: cursor.id } },
    { acknowledgementDueAt: null },
  ] };
}

export function criticalQueuePage<T extends CriticalQueuePosition>(
  rows: readonly T[],
  filter: CriticalQueueFilter,
) {
  const visible = rows.slice(0, CRITICAL_QUEUE_PAGE_SIZE);
  const last = visible.at(-1);
  return {
    rows: visible,
    hasNext: rows.length > CRITICAL_QUEUE_PAGE_SIZE,
    nextCursor: rows.length > CRITICAL_QUEUE_PAGE_SIZE && last
      ? encodeCriticalQueueCursor(last, filter) : null,
  };
}
