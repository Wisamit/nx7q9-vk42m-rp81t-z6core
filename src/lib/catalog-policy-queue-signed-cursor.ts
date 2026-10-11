import { createHmac, timingSafeEqual } from "node:crypto";
import {
  decodePolicyQueueCursor, encodePolicyQueueCursor,
  type PolicyQueueCursor,
} from "./catalog-policy-queue-pagination.ts";

const PURPOSE = "family-lab/catalog-policy-review-queue/cursor/v3\n";
const SIGNATURE = /^[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/;
export const POLICY_QUEUE_CURSOR_TTL_MS = 20 * 60 * 1000;

export type PolicyQueueAuditWatermark = {
  latest: PolicyQueueCursor | null;
  count: number;
};
export type SignedPolicyQueueCursor = {
  after: PolicyQueueCursor;
  anchor: PolicyQueueCursor;
  draftCount: number;
  reviewWatermark: PolicyQueueAuditWatermark;
  expiresAt: number;
};
type Context = {
  organizationId: string; branchId: string; reviewerUserId: string;
  secret: string;
};
const samePosition = (a: PolicyQueueCursor, b: PolicyQueueCursor) =>
  a.occurredAt.getTime() === b.occurredAt.getTime() && a.id === b.id;
const validCount = (count: number) => Number.isSafeInteger(count) && count >= 0;

/**
 * A paired latest-event and count watermark detects any appended/removed row,
 * including a backdated event or a same-millisecond lower-UUID event.
 * It does not authenticate the underlying AuditEvents or detect a privileged
 * malicious in-place modification that keeps the count and latest unchanged.
 */
export function samePolicyQueueAuditWatermark(
  expected: PolicyQueueAuditWatermark, actual: PolicyQueueAuditWatermark,
): boolean {
  return validCount(expected.count) && validCount(actual.count) &&
    (expected.latest === null) === (expected.count === 0) &&
    (actual.latest === null) === (actual.count === 0) &&
    expected.count === actual.count &&
    (expected.latest === null
      ? actual.latest === null
      : actual.latest !== null && samePosition(expected.latest, actual.latest));
}

/** Retained Stage 66 draft-head anti-replay contract. */
export function samePolicyQueueAnchor(
  anchored: PolicyQueueCursor, current: PolicyQueueCursor | null,
): boolean {
  return current !== null && samePosition(anchored, current);
}

/**
 * Bind the cursor to authenticated user, tenant and current branch without
 * exposing those identifiers in the browser payload. It remains navigation
 * evidence, NEVER clinical or financial signing/approval authority.
 */
function mac(payload: string, scope: Context): Buffer {
  return createHmac("sha256", scope.secret)
    .update(PURPOSE)
    .update(JSON.stringify([
      scope.organizationId, scope.branchId, scope.reviewerUserId,
    ]))
    .update("\n")
    .update(payload)
    .digest();
}

export function issueSignedPolicyQueueCursor(input: SignedPolicyQueueCursor & Context): string {
  const { after, anchor, draftCount, reviewWatermark, expiresAt } = input;
  if (!Number.isSafeInteger(expiresAt) || !validCount(draftCount) || draftCount < 1 ||
      !validCount(reviewWatermark.count) ||
      (reviewWatermark.latest === null) !== (reviewWatermark.count === 0) ||
      !Number.isFinite(after.occurredAt.getTime()) ||
      !Number.isFinite(anchor.occurredAt.getTime())) throw Error("policy_queue_cursor_invalid");
  const payload = Buffer.from(JSON.stringify({
    v: 3, p: encodePolicyQueueCursor(after),
    a: encodePolicyQueueCursor(anchor),
    dn: draftCount,
    rp: reviewWatermark.latest ? encodePolicyQueueCursor(reviewWatermark.latest) : null,
    rn: reviewWatermark.count,
    e: expiresAt,
  }), "utf8").toString("base64url");
  return payload + "." + mac(payload, input).toString("hex");
}

/** null = first page; undefined = forged, old-version, expired or wrong scope. */
export function verifySignedPolicyQueueCursor(
  token: string | null, scope: Context, nowMs: number,
): SignedPolicyQueueCursor | null | undefined {
  if (token === null) return null;
  if (!token || token.length > 768 || !TOKEN.test(token) ||
      !Number.isSafeInteger(nowMs)) return undefined;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !SIGNATURE.test(signature)) return undefined;
  try {
    const raw = Buffer.from(payload, "base64url");
    if (raw.toString("base64url") !== payload) return undefined;
    const actual = Buffer.from(signature, "hex");
    if (!timingSafeEqual(actual, mac(payload, scope))) return undefined;
    const obj: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return undefined;
    const data = obj as Record<string, unknown>;
    if (Object.keys(data).sort().join(",") !== "a,dn,e,p,rn,rp,v" || data.v !== 3 ||
        typeof data.a !== "string" || typeof data.p !== "string" ||
        !Number.isSafeInteger(data.e) || (data.e as number) <= nowMs ||
        (data.e as number) > nowMs + POLICY_QUEUE_CURSOR_TTL_MS ||
        typeof data.dn !== "number" || !validCount(data.dn) || data.dn < 1 ||
        typeof data.rn !== "number" || !validCount(data.rn) ||
        (data.rp !== null && typeof data.rp !== "string") ||
        (data.rp === null) !== (data.rn === 0)) return undefined;
    const after = decodePolicyQueueCursor(data.p);
    const anchor = decodePolicyQueueCursor(data.a);
    const reviewHead = data.rp === null ? null : decodePolicyQueueCursor(data.rp as string);
    if (!after || !anchor || typeof after !== "object" || typeof anchor !== "object" ||
        reviewHead === undefined ||
        (data.rp !== null && !reviewHead)) return undefined;
    // Cannot advance beyond the original top-of-list audit watermark.
    if (after.occurredAt.getTime() > anchor.occurredAt.getTime() ||
        (after.occurredAt.getTime() === anchor.occurredAt.getTime() &&
          after.id > anchor.id)) return undefined;
    return {
      after, anchor, draftCount: data.dn,
      reviewWatermark: { latest: reviewHead, count: data.rn },
      expiresAt: data.e as number,
    };
  } catch {
    return undefined;
  }
}
