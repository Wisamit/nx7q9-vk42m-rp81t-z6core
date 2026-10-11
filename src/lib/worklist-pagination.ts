import { createHash } from "node:crypto";
import type { Prisma } from "../../generated/prisma/client";

export const WORKLIST_PAGE_SIZE = 50;

export type WorklistFilterState = {
  q: string;
  status: string;
  department: string;
  branch: string;
  priority: string;
  specimenStatus: string;
  due: string;
  analyzer: string;
};

export type WorklistCursorPosition = {
  id: string;
  createdAt: Date;
};

const FILTER_KEYS = [
  "q", "status", "department", "branch", "priority", "specimenStatus", "due", "analyzer",
] as const;

export function worklistFilterFingerprint(filters: WorklistFilterState): string {
  return createHash("sha256").update(
    JSON.stringify(FILTER_KEYS.map(key => [key, filters[key]])),
  ).digest("hex").slice(0, 24);
}

/**
 * The cursor represents a position only, not a permission grant. Every query
 * must re-apply tenant, active branch and department scopes independently.
 */
export function encodeWorklistCursor(
  position: WorklistCursorPosition,
  filters: WorklistFilterState,
): string {
  return Buffer.from(JSON.stringify({
    v: 1,
    filter: worklistFilterFingerprint(filters),
    id: position.id,
    created: position.createdAt.toISOString(),
  })).toString("base64url");
}

export function decodeWorklistCursor(
  token: string | undefined,
  filters: WorklistFilterState,
): WorklistCursorPosition | null {
  if (!token || token.length > 512 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  try {
    const data: unknown = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (!data || Array.isArray(data) || typeof data !== "object") return null;
    const value = data as Record<string, unknown>;
    if (value.v !== 1 || value.filter !== worklistFilterFingerprint(filters) ||
      typeof value.id !== "string" || typeof value.created !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.id)) return null;
    const createdAt = new Date(value.created);
    if (!Number.isFinite(createdAt.getTime()) ||
      createdAt.toISOString() !== value.created) return null;
    return { id: value.id, createdAt };
  } catch {
    return null;
  }
}

export function worklistAfterWhere(
  cursor: WorklistCursorPosition | null,
): Prisma.OrderItemWhereInput {
  return cursor ? { OR: [
    { createdAt: { gt: cursor.createdAt } },
    { createdAt: cursor.createdAt, id: { gt: cursor.id } },
  ] } : {};
}

export function worklistPage<T extends WorklistCursorPosition>(
  rows: readonly T[],
  filters: WorklistFilterState,
) {
  const visible = rows.slice(0, WORKLIST_PAGE_SIZE);
  const last = visible.at(-1);
  const hasNext = rows.length > WORKLIST_PAGE_SIZE;
  return {
    rows: visible,
    hasNext,
    nextCursor: hasNext && last ? encodeWorklistCursor(last, filters) : null,
  };
}

export function worklistPageHref(
  filters: WorklistFilterState,
  nextCursor: string | null,
): string {
  const query = new URLSearchParams();
  for (const key of FILTER_KEYS) if (filters[key]) query.set(key, filters[key]);
  if (nextCursor) query.set("after", nextCursor);
  const suffix = query.toString();
  return suffix ? "/worklists?" + suffix : "/worklists";
}
