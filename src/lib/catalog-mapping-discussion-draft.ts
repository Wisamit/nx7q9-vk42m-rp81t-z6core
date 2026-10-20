import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const MAPPING_DISCUSSION_HISTORY_LIMIT = 100;
export type MappingDiscussionIntent =
  "REQUEST_EXTERNAL_MAPPING" | "RETURN_TO_SOURCE_AUTHOR" |
  "PROPOSE_LOCAL_RECONCILIATION";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA = /^[0-9a-f]{64}$/;
const SEAL_PURPOSE = "family-lab/catalog-mapping-discussion-audit/v1\\n";

export type MappingDiscussionSeal = {
  version: 1; algorithm: "HMAC-SHA256"; signature: string;
};
const exact = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, expected: string[]) =>
  Object.keys(value).sort().join(",") === expected.sort().join(",");

export function validMappingDiscussionIntent(input: unknown): input is MappingDiscussionIntent {
  return input === "REQUEST_EXTERNAL_MAPPING" ||
    input === "RETURN_TO_SOURCE_AUTHOR" ||
    input === "PROPOSE_LOCAL_RECONCILIATION";
}

export type MappingDiscussionContext = {
  organizationId: string; batchId: string; branchId: string; rowId: string;
  authorUserId: string; sourceChecksum: string;
  rowNumber: number; entityType: string;
};

export type MappingDiscussionDraft = MappingDiscussionContext & {
  revision: number; previousDigest: string | null;
  observationToken: string; intent: MappingDiscussionIntent;
  digest: string; seal: MappingDiscussionSeal;
  state: "UNAPPROVED_MAPPING_DISCUSSION";
  reviewOnly: true; approved: false; signingEnabled: false;
  mappingApproved: false; activated: false; liveWrites: false;
};

const contextFields: (keyof MappingDiscussionContext)[] = [
  "organizationId", "batchId", "branchId", "rowId",
  "authorUserId", "sourceChecksum", "rowNumber", "entityType",
];
const payloadFields = [...contextFields, "revision","previousDigest",
  "observationToken","intent","digest","seal","state","reviewOnly","approved",
  "signingEnabled","mappingApproved","activated","liveWrites"];

function validContext(c: MappingDiscussionContext): boolean {
  return [c.organizationId,c.batchId,c.branchId,c.rowId,c.authorUserId]
    .every(x => typeof x === "string" && UUID.test(x)) &&
    SHA.test(c.sourceChecksum) &&
    Number.isSafeInteger(c.rowNumber) && c.rowNumber > 0 &&
    /^[A-Z_]{1,40}$/.test(c.entityType);
}

/**
 * A checksum links revisions to an immutable audit context and a precise
 * current source/live observation. NOT a qualified signature or apply grant.
 * Never include clinical or price values in the browser-facing response.
 */
export function mappingDiscussionDigest(input: MappingDiscussionContext & {
  revision: number; previousDigest: string | null;
  observationToken: string; intent: MappingDiscussionIntent;
}): string {
  if (!validContext(input) || !Number.isSafeInteger(input.revision) ||
      input.revision < 1 || input.revision > MAPPING_DISCUSSION_HISTORY_LIMIT ||
      (input.previousDigest !== null && !SHA.test(input.previousDigest)) ||
      !SHA.test(input.observationToken) ||
      !validMappingDiscussionIntent(input.intent))
    throw Error("mapping_discussion_invalid_input");
  return createHash("sha256").update(JSON.stringify([
    "FAMILY_LAB_MAPPING_DISCUSSION_DRAFT_V1",
    ...contextFields.map(field=>input[field]),
    input.revision,input.previousDigest,input.observationToken,input.intent,
  ])).digest("hex");
}

/**
 * Stage HMAC and mapping audit HMAC are domain-separated even when the same
 * server secret is configured. The seal protects the entire authored record,
 * not only a public hash which a database editor could recompute.
 */
export function createMappingDiscussionDraft(
  context: MappingDiscussionContext, input: {
    revision: number; previousDigest: string | null;
    observationToken: string; intent: MappingDiscussionIntent;
  }, secret: string,
): MappingDiscussionDraft {
  if (typeof secret !== "string" || Buffer.byteLength(secret,"utf8") < 32)
    throw Error("mapping_discussion_signing_key_unavailable");
  const digest = mappingDiscussionDigest({...context,...input});
  const unsigned = {...context,...input,digest,
    state:"UNAPPROVED_MAPPING_DISCUSSION" as const,
    reviewOnly:true as const,approved:false as const,signingEnabled:false as const,
    mappingApproved:false as const,activated:false as const,liveWrites:false as const};
  const payload = JSON.stringify([
    SEAL_PURPOSE, ...contextFields.map(field => unsigned[field]),
    unsigned.revision, unsigned.previousDigest, unsigned.observationToken,
    unsigned.intent, unsigned.digest, unsigned.state, unsigned.reviewOnly,
    unsigned.approved, unsigned.signingEnabled, unsigned.mappingApproved,
    unsigned.activated, unsigned.liveWrites,
  ]);
  const seal:MappingDiscussionSeal = {
    version:1,algorithm:"HMAC-SHA256",
    signature:createHmac("sha256",secret).update(payload).digest("hex"),
  };
  return {...unsigned,seal};
}

export function parseMappingDiscussionDraft(
  value: unknown, context: MappingDiscussionContext, secret: string,
): MappingDiscussionDraft | null {
  if (!exact(value) || !validContext(context) ||
      !keys(value,[...payloadFields]) ||
      contextFields.some(field => value[field] !== context[field]) ||
      !Number.isSafeInteger(value.revision) ||
      typeof value.observationToken !== "string" ||
      !validMappingDiscussionIntent(value.intent) ||
      value.state !== "UNAPPROVED_MAPPING_DISCUSSION" ||
      value.reviewOnly !== true || value.approved !== false ||
      value.signingEnabled !== false || value.mappingApproved !== false ||
      value.activated !== false || value.liveWrites !== false ||
      (value.previousDigest !== null && typeof value.previousDigest !== "string") ||
      !exact(value.seal) || !keys(value.seal,["version","algorithm","signature"]) ||
      value.seal.version !== 1 || value.seal.algorithm !== "HMAC-SHA256" ||
      typeof value.seal.signature !== "string" || !SHA.test(value.seal.signature))
    return null;
  try {
    const draft = createMappingDiscussionDraft(context,{
      revision:value.revision as number,
      previousDigest:value.previousDigest as string | null,
      observationToken:value.observationToken,
      intent:value.intent,
    },secret);
    if (draft.digest !== value.digest) return null;
    return timingSafeEqual(
      Buffer.from(draft.seal.signature,"hex"),
      Buffer.from(value.seal.signature,"hex")
    ) ? draft : null;
  } catch { return null; }
}

type MappingAuditEvent = {
  id: string; branchId: string | null;
  actorUserId: string | null; newValues: unknown;
};

/**
 * Examine the WHOLE bounded history in actual append order (latest first).
 * Reject missing, duplicate, foreign-user/branch, forged or reordered audits.
 * A digest chain is only a corruption check, not authenticated authorship.
 */
export function verifyMappingDiscussionHistory(input: {
  context: MappingDiscussionContext; events: readonly MappingAuditEvent[];
  secret: string;
}): { revision: number; draft: MappingDiscussionDraft | null } | null {
  const {context,events,secret} = input;
  if (!validContext(context) || typeof secret !== "string" ||
      Buffer.byteLength(secret,"utf8") < 32 ||
      events.length > MAPPING_DISCUSSION_HISTORY_LIMIT) return null;
  if (!events.length) return {revision:0,draft:null};
  const ids = new Set<string>();
  const parsed = new Map<number,MappingDiscussionDraft>();
  for (const event of events) {
    if (!UUID.test(event.id) || ids.has(event.id) ||
        event.branchId !== context.branchId ||
        event.actorUserId !== context.authorUserId) return null;
    ids.add(event.id);
    const draft = parseMappingDiscussionDraft(event.newValues,context,secret);
    if (!draft || parsed.has(draft.revision)) return null;
    parsed.set(draft.revision,draft);
  }
  for(let revision=1; revision<=events.length;revision++) {
    const item=parsed.get(revision);
    if (!item) return null;
    if(item.previousDigest !== (revision===1 ? null : parsed.get(revision-1)!.digest))
      return null;
  }
  const last=parsed.get(events.length)!;
  if (parseMappingDiscussionDraft(events[0].newValues,context,secret)?.digest !== last.digest)
    return null;
  return {revision:events.length,draft:last};
}

export function mappingDiscussionCurrent(
  value: MappingDiscussionDraft | null, currentObservation: string,
): boolean {
  return !!value && SHA.test(currentObservation) &&
    value.observationToken === currentObservation;
}
