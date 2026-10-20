import { createHmac, timingSafeEqual } from "node:crypto";
import { canonicalJson, type Json } from "./catalog-bundle-attestation.ts";

const PURPOSE = "family-lab/catalog-review-stage-evidence/v1\\n";
const HEX = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export type ReviewStageEvidenceSeal = {
  version: 1 | 2; algorithm: "HMAC-SHA256"; signature: string;
};
export type ReviewStageEvidenceRow = {
  id: string; rowNumber: number; entityType: string; legacyKey: string | null;
  status: string; sourceData: unknown; normalizedData: unknown;
  validationIssues: unknown; importedEntityId: string | null;
};
export type ReviewStageEvidenceBatchMetadata = {
  sourceType: string; sourceName: string; status: string; summary: unknown;
};
export type ReviewStageEvidenceContext = {
  organizationId: string; batchId: string; authorUserId: string;
  sourceChecksum: string; rows: readonly ReviewStageEvidenceRow[];
  batchMetadata?: ReviewStageEvidenceBatchMetadata;
};

/** Remove only the stored seal; everything else must remain MAC-bound. */
export function reviewStageBatchMetadata(batch: ReviewStageEvidenceBatchMetadata): ReviewStageEvidenceBatchMetadata | null {
  if (!batch.summary || typeof batch.summary !== "object" || Array.isArray(batch.summary) ||
      !Object.hasOwn(batch.summary, "stageEvidenceSeal")) return null;
  const { stageEvidenceSeal: _seal, ...summary } = batch.summary as Record<string, unknown>;
  return { sourceType: batch.sourceType, sourceName: batch.sourceName,
    status: batch.status, summary };
}

function checkedMetadata(value: ReviewStageEvidenceBatchMetadata, rows: readonly ReviewStageEvidenceRow[]): ReviewStageEvidenceBatchMetadata {
  const s = value.summary;
  if (value.sourceType !== "CONFIG_BUNDLE_REVIEW" || value.status !== "DRAFT" ||
      typeof value.sourceName !== "string" || !value.sourceName.endsWith(".json") ||
      value.sourceName.length > 255 ||
      !s || typeof s !== "object" || Array.isArray(s)) throw Error("stage_evidence_invalid_metadata");
  const summary = s as Record<string, unknown>;
  if (Object.keys(summary).sort().join(",") !==
      "WARNING,attestationStatus,consistency,counts,exportedAt,fieldContractStatus,format,reviewOnly,total" ||
      summary.total !== rows.length || summary.WARNING !== rows.length ||
      summary.reviewOnly !== true || summary.format !== "family-lab-catalog-bundle" ||
      !["VERIFIED", "UNVERIFIED"].includes(String(summary.attestationStatus)) ||
      !["COMPLETE_SOURCE_FIELD_PROJECTION", "LEGACY_NO_FIELD_CONTRACT"].includes(String(summary.fieldContractStatus)) ||
      !["transactional-consistent-read", "paged-live-not-atomic"].includes(String(summary.consistency)) ||
      typeof summary.exportedAt !== "string" ||
      !Number.isFinite(Date.parse(summary.exportedAt)) ||
      !summary.counts || typeof summary.counts !== "object" || Array.isArray(summary.counts))
    throw Error("stage_evidence_invalid_metadata");
  const counts = summary.counts as Record<string, unknown>;
  if (Object.keys(counts).some(k => !k || !Number.isSafeInteger(counts[k]) ||
        (counts[k] as number) < 0) ||
      Object.values(counts).reduce<number>((sum, n) => sum + (n as number), 0) !== rows.length)
    throw Error("stage_evidence_invalid_metadata");
  return value;
}

/**
 * Authenticates the persisted review-only staging envelope, not the
 * submitted file's independent provenance or its clinical correctness.
 * Re-read row JSON from MariaDB before sealing, not the request payload.
 */
function serializedEvidence(input: ReviewStageEvidenceContext): string {
  if (![input.organizationId, input.batchId, input.authorUserId].every(x =>
        UUID.test(x)) ||
      !HEX.test(input.sourceChecksum) || !input.rows.length ||
      input.rows.length > 5000) throw new Error("stage_evidence_invalid_context");
  const seen = new Set<string>();
  const rows = input.rows.map((row, index) => {
    if (!UUID.test(row.id) || seen.has(row.id) ||
        row.rowNumber !== index + 1 || row.status !== "WARNING" ||
        row.importedEntityId !== null ||
        !row.entityType || typeof row.entityType !== "string" ||
        (row.legacyKey !== null && typeof row.legacyKey !== "string") ||
        row.sourceData === undefined || row.normalizedData === undefined ||
        row.validationIssues === undefined)
      throw new Error("stage_evidence_invalid_row");
    seen.add(row.id);
    return {
      id: row.id, rowNumber: row.rowNumber, entityType: row.entityType,
      legacyKey: row.legacyKey, status: row.status,
      sourceData: row.sourceData, normalizedData: row.normalizedData,
      validationIssues: row.validationIssues,
      importedEntityId: row.importedEntityId,
    };
  });
  // Source is JSON from MariaDB. canonicalJson rejects unexpected
  // prototype/undefined/non-finite values rather than silently omitting them.
  const batchMetadata = input.batchMetadata
    ? checkedMetadata(input.batchMetadata, input.rows) : undefined;
  return canonicalJson({
    version: batchMetadata ? 2 : 1, organizationId: input.organizationId,
    batchId: input.batchId, authorUserId: input.authorUserId,
    sourceChecksum: input.sourceChecksum, rows,
    ...(batchMetadata ? { batchMetadata } : {}),
  } as Json);
}

function mac(input: ReviewStageEvidenceContext, secret: string): string {
  if (Buffer.byteLength(secret, "utf8") < 32) throw Error("stage_evidence_key_unavailable");
  return createHmac("sha256", secret).update(PURPOSE).update(serializedEvidence(input)).digest("hex");
}

export function sealReviewStageEvidence(
  input: ReviewStageEvidenceContext, secret: string,
): ReviewStageEvidenceSeal {
  return { version: input.batchMetadata ? 2 : 1,
    algorithm: "HMAC-SHA256", signature: mac(input, secret) };
}

/**
 * Old unsealed drafts or key rotation fail closed. Never accept an unsigned
 * fallback, unrecognized algorithm, or malformed/foreign-tenant seal.
 */
export function verifyReviewStageEvidence(
  input: ReviewStageEvidenceContext, value: unknown, secret: string | null,
): boolean {
  if (!secret || !value || typeof value !== "object" || Array.isArray(value)) return false;
  const seal = value as Record<string, unknown>;
  if (seal.version !== (input.batchMetadata ? 2 : 1) ||
      seal.algorithm !== "HMAC-SHA256" ||
      typeof seal.signature !== "string" || !HEX.test(seal.signature) ||
      Object.keys(seal).length !== 3) return false;
  try {
    const actual = Buffer.from(seal.signature, "hex");
    const expected = Buffer.from(mac(input, secret), "hex");
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
