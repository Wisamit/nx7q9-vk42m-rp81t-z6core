const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const POLICY_QUEUE_EVENT_WINDOW = 100;
export const POLICY_QUEUE_ENTRY_LIMIT = 30;

export type PolicyQueueCursor = { occurredAt: Date; id: string };

/**
 * Opaque positional key, NOT an authorization token or signature.
 * Each request independently verifies tenant, branch, grants, history,
 * reviewer separation and all source/live-master scope.
 */
export function encodePolicyQueueCursor(cursor: PolicyQueueCursor): string {
  return Buffer.from(JSON.stringify({
    t: cursor.occurredAt.toISOString(), i: cursor.id.toLowerCase(),
  }), "utf8").toString("base64url");
}

/** null = first page; undefined = invalid supplied cursor. */
export function decodePolicyQueueCursor(value: string | null): PolicyQueueCursor | null | undefined {
  if (value === null) return null;
  if (!value || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value))
    return undefined;
  try {
    const bytes = Buffer.from(value, "base64url");
    if (bytes.toString("base64url") !== value) return undefined;
    const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const record = raw as Record<string, unknown>;
    if (Object.keys(record).sort().join(",") !== "i,t" ||
        typeof record.i !== "string" || !UUID.test(record.i) ||
        record.i !== record.i.toLowerCase() ||
        typeof record.t !== "string" || !ISO_UTC.test(record.t)) return undefined;
    const occurredAt = new Date(record.t);
    if (!Number.isFinite(occurredAt.getTime()) ||
        occurredAt.toISOString() !== record.t) return undefined;
    return { occurredAt, id: record.i };
  } catch {
    return undefined;
  }
}

export function policyQueueNextPage(input: {
  window: readonly PolicyQueueCursor[];
  lastScanned: PolicyQueueCursor | null;
  overflow: boolean;
}): { hasMore: boolean; nextCursor: string | null } {
  if (!input.lastScanned) return { hasMore: false, nextCursor: null };
  // An early stop after 30 eligible entries must resume from the last
  // examined event, not the end of the 100-event window.
  const more = input.overflow ||
    input.window.some(event => event.id !== input.lastScanned?.id &&
      (event.occurredAt.getTime() < input.lastScanned!.occurredAt.getTime() ||
        (event.occurredAt.getTime() === input.lastScanned!.occurredAt.getTime() &&
          event.id < input.lastScanned!.id)));
  return { hasMore: more,
    nextCursor: more ? encodePolicyQueueCursor(input.lastScanned) : null };
}
