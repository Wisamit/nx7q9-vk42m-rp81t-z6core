import { createHmac, timingSafeEqual } from "node:crypto";
import {
  decodePolicyQueueCursor, encodePolicyQueueCursor,
  type PolicyQueueCursor,
} from "./catalog-policy-queue-pagination.ts";

const PURPOSE = "family-lab/catalog-policy-review-queue/cursor/v2\n";
const SIGNATURE = /^[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]+\.[0-9a-f]{64}$/;
export const POLICY_QUEUE_CURSOR_TTL_MS = 20 * 60 * 1000;

export type SignedPolicyQueueCursor = {
  after: PolicyQueueCursor;
  anchor: PolicyQueueCursor;
  expiresAt: number;
};
type Context = {
  organizationId: string; branchId: string; reviewerUserId: string;
  secret: string;
};
const samePosition = (a: PolicyQueueCursor, b: PolicyQueueCursor) =>
  a.occurredAt.getTime() === b.occurredAt.getTime() && a.id === b.id;

/**
 * Bind the cursor to authenticated user, tenant and currently active branch,
 * without revealing those identifiers in the browser-visible payload.
 * This token is pagination evidence only, never signatory approval.
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
  const { after, anchor, expiresAt } = input;
  if (!Number.isSafeInteger(expiresAt) || !Number.isFinite(after.occurredAt.getTime()) ||
      !Number.isFinite(anchor.occurredAt.getTime())) throw Error("policy_queue_cursor_invalid");
  const payload = Buffer.from(JSON.stringify({
    v: 2, p: encodePolicyQueueCursor(after),
    a: encodePolicyQueueCursor(anchor), e: expiresAt,
  }), "utf8").toString("base64url");
  return payload + "." + mac(payload, input).toString("hex");
}

/** null = initial page; undefined = forged, expired, malformed or wrong scope. */
export function verifySignedPolicyQueueCursor(
  token: string | null, scope: Context, nowMs: number,
): SignedPolicyQueueCursor | null | undefined {
  if (token === null) return null;
  if (!token || token.length > 512 || !TOKEN.test(token) ||
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
    if (Object.keys(data).sort().join(",") !== "a,e,p,v" || data.v !== 2 ||
        typeof data.a !== "string" || typeof data.p !== "string" ||
        !Number.isSafeInteger(data.e) || (data.e as number) <= nowMs ||
        (data.e as number) > nowMs + POLICY_QUEUE_CURSOR_TTL_MS) return undefined;
    const after = decodePolicyQueueCursor(data.p);
    const anchor = decodePolicyQueueCursor(data.a);
    if (!after || !anchor || typeof after !== "object" || typeof anchor !== "object")
      return undefined;
    // The position cannot precede the original top-of-list watermark in
    // descending order. Equal is valid when all newer records were scanned.
    if (after.occurredAt.getTime() > anchor.occurredAt.getTime() ||
        (after.occurredAt.getTime() === anchor.occurredAt.getTime() &&
          after.id > anchor.id)) return undefined;
    return { after, anchor, expiresAt: data.e as number };
  } catch {
    return undefined;
  }
}

export function samePolicyQueueAnchor(
  anchored: PolicyQueueCursor, current: PolicyQueueCursor | null,
): boolean {
  return current !== null && samePosition(anchored, current);
}
