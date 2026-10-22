import { LEGACY_COVERAGE_SOURCES } from "./legacy-source-coverage.ts";

export const LEGACY_ROW_LINEAGE_TYPE = "FAMILY_LAB_LEGACY_MDB_ROW_HASHES_REVIEW_ONLY";
export const LEGACY_ROW_LINEAGE_MAX_BYTES = 256 * 1024;
export const LEGACY_ROW_LINEAGE_PAGE_SIZE = 500;
export const legacyRowHex = /^[a-f0-9]{64}$/;
export const legacyRowUuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export const legacyRowClassifications = [
  "UNRESOLVED", "AMBIGUOUS", "NOT_IMPORTED", "MAPPED", "APPROVED_MAPPING",
] as const;
export type LegacyRowClassification = typeof legacyRowClassifications[number];

export const legacyRowTargets: Readonly<Record<string, readonly string[]>> = {
  "Test name": ["TEST", "COMPONENT"],
  test: ["TEST"],
  profile: ["PANEL", "PACKAGE"],
  normal: ["REFERENCE_INTERVAL"],
  price: ["PRICE_LIST_ITEM", "PRICE_LIST_PACKAGE_ITEM", "PRICE_LIST", "CONTRACT"],
  Unites: ["UNIT"],
  Tube: ["CONTAINER"],
  Tubes: ["CONTAINER"],
  Comment: ["COMMENT_TEMPLATE"],
  ORGANISM: ["ORGANISM"],
  Antibiotic: ["ANTIBIOTIC"],
  Fungi: ["ORGANISM"],
  Referdby: ["REFERRER", "CLIENT"],
  Source: ["SOURCE", "CLIENT"],
  Gropes: ["PANEL", "PACKAGE"],
};

export class LegacyLineageError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export type LegacyRowHash = { rowDigest: string; occurrence: number };
export type LegacyRowManifest = {
  schemaVersion: 1; evidenceType: typeof LEGACY_ROW_LINEAGE_TYPE;
  sourceName: string; sourceSha256: string; sourceBytes: number;
  tableName: string; schemaSha256: string; digestKeyId: string; sourceRowCount: number;
  chunkIndex: number; chunkCount: number;
  exportedAtUtc: string; includesPatientData: false;
  rows: LegacyRowHash[];
};

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new LegacyLineageError("invalid_row_lineage_manifest");
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const expected = [...keys].sort().join(",");
  return Object.keys(value).sort().join(",") === expected;
}
function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= min && value <= max;
}
export function parseLegacyRowManifest(value: unknown): LegacyRowManifest {
  const input = object(value);
  if (!exactKeys(input, [
    "schemaVersion", "evidenceType", "sourceName", "sourceSha256", "sourceBytes",
    "tableName", "schemaSha256", "digestKeyId", "sourceRowCount", "chunkIndex", "chunkCount",
    "exportedAtUtc", "includesPatientData", "rows",
  ]) || input.schemaVersion !== 1 || input.evidenceType !== LEGACY_ROW_LINEAGE_TYPE ||
      input.includesPatientData !== false ||
      typeof input.sourceName !== "string" || !/^[^\\/\u0000-\u001f]{1,255}\.(?:mdb|accdb)$/i.test(input.sourceName) ||
      typeof input.sourceSha256 !== "string" || !legacyRowHex.test(input.sourceSha256) ||
      !integer(input.sourceBytes, 1, 1_000_000_000) ||
      typeof input.tableName !== "string" ||
      !LEGACY_COVERAGE_SOURCES.some(source => source.tableName === input.tableName) ||
      typeof input.schemaSha256 !== "string" || !legacyRowHex.test(input.schemaSha256) ||
      typeof input.digestKeyId !== "string" || !legacyRowHex.test(input.digestKeyId) ||
      !integer(input.sourceRowCount, 0, 10_000_000) ||
      !integer(input.chunkCount, 1, 20_000) ||
      !integer(input.chunkIndex, 0, (input.chunkCount as number) - 1) ||
      typeof input.exportedAtUtc !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T/.test(input.exportedAtUtc) ||
      !Number.isFinite(Date.parse(input.exportedAtUtc)) ||
      !Array.isArray(input.rows) || input.rows.length > LEGACY_ROW_LINEAGE_PAGE_SIZE) {
    throw new LegacyLineageError("invalid_row_lineage_manifest");
  }
  const rows: LegacyRowHash[] = [];
  const seen = new Set<string>();
  for (const raw of input.rows) {
    const item = object(raw);
    if (!exactKeys(item, ["rowDigest", "occurrence"]) ||
        typeof item.rowDigest !== "string" || !legacyRowHex.test(item.rowDigest) ||
        !integer(item.occurrence, 1, 10_000_000)) {
      throw new LegacyLineageError("invalid_legacy_row_digest");
    }
    const fingerprint = item.rowDigest + ":" + item.occurrence;
    if (seen.has(fingerprint)) throw new LegacyLineageError("duplicate_source_row_identity");
    seen.add(fingerprint);
    rows.push({ rowDigest: item.rowDigest, occurrence: item.occurrence as number });
  }
  // Chunk headers are manifest claims; completeness requires DB reconciliation
  // across all chunks and independent source validation. Zero rows are allowed.
  if (input.sourceRowCount === 0 && (rows.length !== 0 || input.chunkCount !== 1) ||
      rows.length > (input.sourceRowCount as number) ||
      (input.sourceRowCount as number) > 0 && rows.length === 0) {
    throw new LegacyLineageError("invalid_row_lineage_count");
  }
  return { ...input, rows } as LegacyRowManifest;
}

export type LegacyRowDecision = {
  id: string; expectedRevision: number; classification: LegacyRowClassification;
  reason: string; targetType: string | null; targetId: string | null;
  batchId: string | null; importRowId: string | null;
};
export function parseLegacyRowDecision(value: unknown): LegacyRowDecision {
  const v = object(value);
  if (!exactKeys(v, ["id", "expectedRevision", "classification", "reason",
    "targetType", "targetId", "batchId", "importRowId"]) ||
    typeof v.id !== "string" || !legacyRowUuid.test(v.id) ||
    !integer(v.expectedRevision, 0, 100000) ||
    !legacyRowClassifications.includes(v.classification as LegacyRowClassification) ||
    typeof v.reason !== "string" || v.reason.trim().length < 12 ||
    v.reason.length > 1000 ||
    (v.targetType !== null && (typeof v.targetType !== "string" || v.targetType.length > 40)) ||
    (v.targetId !== null && (typeof v.targetId !== "string" || !legacyRowUuid.test(v.targetId))) ||
    (v.batchId !== null && (typeof v.batchId !== "string" || !legacyRowUuid.test(v.batchId))) ||
    (v.importRowId !== null && (typeof v.importRowId !== "string" || !legacyRowUuid.test(v.importRowId))) ||
    ((v.classification === "MAPPED" || v.classification === "APPROVED_MAPPING") !==
     (v.targetType !== null && v.targetId !== null)) ||
    (v.importRowId !== null && v.batchId === null)) {
    throw new LegacyLineageError("invalid_row_lineage_decision");
  }
  return { ...v, reason: v.reason.trim() } as LegacyRowDecision;
}
export function legacyLineageDomainPermission(targetType: string): string {
  if (["PRICE_LIST_ITEM", "PRICE_LIST_PACKAGE_ITEM", "PRICE_LIST", "CONTRACT"].includes(targetType))
    return "pricing.manage";
  if (targetType === "REFERENCE_INTERVAL" || targetType === "COMPONENT" ||
      targetType === "COMMENT_TEMPLATE") return "catalog.reference_ranges.manage";
  return "catalog.manage";
}
export function legacyLineageMappingAllowed(sourceTable: string, targetType: string) {
  return legacyRowTargets[sourceTable]?.includes(targetType) === true;
}
