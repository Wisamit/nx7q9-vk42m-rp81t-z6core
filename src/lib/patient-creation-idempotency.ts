import { createHash } from "node:crypto";

/** Optional for legacy API clients; all new staff UI requests send a UUID. */
export function patientCreationSubmissionKey(value: string | null):
  { valid: true; key: string | null } | { valid: false; key: null } {
  if (value === null) return { valid: true, key: null };
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)) {
    return { valid: false, key: null };
  }
  return { valid: true, key: value.toLowerCase() };
}

/** Exact, order-independent JSON intent; never log source PII or payloads. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).sort()
      .map(key => JSON.stringify(key) + ":" + canonicalJson(record[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}

export function patientCreationPayloadHash(payload: unknown): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

type PreviousPatientCreation = {
  id: string;
  status: string;
  mergedIntoPatientId: string | null;
  creationPayloadHash: string | null;
};

/**
 * A repeated key is successful ONLY for the exact same original submission
 * and still-active unmerged identity. Key collisions with changed content or
 * later identity merges/deactivation MUST NOT be presented as new creation.
 */
export function evaluatePatientCreationReplay(
  previous: PreviousPatientCreation | null,
  payloadHash: string,
): { kind: "new" } | { kind: "replay"; id: string } |
  { kind: "conflict" } | { kind: "record_changed" } {
  if (!previous) return { kind: "new" };
  if (!previous.creationPayloadHash || previous.creationPayloadHash !== payloadHash)
    return { kind: "conflict" };
  if (previous.status !== "ACTIVE" || previous.mergedIntoPatientId !== null)
    return { kind: "record_changed" };
  return { kind: "replay", id: previous.id };
}
