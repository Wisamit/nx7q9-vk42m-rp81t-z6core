import { createHash } from "node:crypto";

export const LEGACY_COVERAGE_TYPE = "FAMILY_LAB_LEGACY_MDB_SOURCE_COVERAGE_REVIEW_ONLY";
export const LEGACY_COVERAGE_MAX_BYTES = 64 * 1024;

/**
 * A deliberately narrow table allowlist. This never queries patient, order,
 * payment or result tables. Table counts are NOT one-to-one migration evidence.
 */
export const LEGACY_COVERAGE_SOURCES = [
  { tableName: "Test name", target: "TEST", mode: "STAGED" },
  { tableName: "test", target: "TEST_ALIAS", mode: "MANUAL" },
  { tableName: "profile", target: "PANEL", mode: "STAGED" },
  { tableName: "normal", target: "REFERENCE_INTERVAL", mode: "STAGED" },
  { tableName: "price", target: "PRICE_LIST_ITEM", mode: "STAGED" },
  { tableName: "Unites", target: "UNIT", mode: "STAGED" },
  { tableName: "Tube", target: "CONTAINER", mode: "STAGED" },
  { tableName: "Tubes", target: "CONTAINER", mode: "STAGED" },
  { tableName: "Comment", target: "COMMENT_TEMPLATE", mode: "DIRECT" },
  { tableName: "ORGANISM", target: "ORGANISM", mode: "DIRECT" },
  { tableName: "Antibiotic", target: "ANTIBIOTIC", mode: "DIRECT" },
  { tableName: "Fungi", target: "ORGANISM", mode: "DIRECT" },
  { tableName: "Referdby", target: "REFERRER", mode: "DIRECT" },
  { tableName: "Source", target: "SOURCE", mode: "DIRECT" },
  { tableName: "Gropes", target: "GROUP", mode: "MANUAL" },
] as const;

export type SourceEvidenceTable = {
  tableName: string;
  present: boolean;
  rowCount: number;
  columnCount: number;
  schemaSha256: string | null;
};
export type LegacySourceCoverage = {
  schemaVersion: 1;
  evidenceType: typeof LEGACY_COVERAGE_TYPE;
  sourceName: string;
  sourceSha256: string;
  sourceBytes: number;
  exportedAtUtc: string;
  includesPatientData: false;
  tables: SourceEvidenceTable[];
};
export type StagedCoverageCount = {
  entityType: string;
  status: string;
  count: number;
};
export class LegacyCoverageError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
const fail = (code: string): never => { throw new LegacyCoverageError(code); };
const obj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const sha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{64}$/.test(v);
const known = new Map<string, (typeof LEGACY_COVERAGE_SOURCES)[number]>(
  LEGACY_COVERAGE_SOURCES.map(x => [x.tableName.toLowerCase(), x]),
);

export function parseLegacySourceCoverage(input: unknown): LegacySourceCoverage {
  // Refuse unexpected properties so patient/result/master row payloads cannot
  // masquerade as metadata-only evidence (even if the known fields are valid).
  const allowedHeader = new Set(["schemaVersion","evidenceType","sourceName",
    "sourceSha256","sourceBytes","exportedAtUtc","includesPatientData","tables"]);
  if (!obj(input) || Object.keys(input).some(k => !allowedHeader.has(k)))
    return fail("invalid_legacy_source_manifest");
  if (!obj(input) || input.schemaVersion !== 1 || input.evidenceType !== LEGACY_COVERAGE_TYPE ||
      input.includesPatientData !== false ||
      typeof input.sourceName !== "string" || input.sourceName.length > 255 ||
      !/^[^\\/\u0000-\u001f\u007f]+\.(?:mdb|accdb)$/i.test(input.sourceName) ||
      !sha(input.sourceSha256) || !Number.isSafeInteger(input.sourceBytes) ||
      (input.sourceBytes as number) < 1 ||
      typeof input.exportedAtUtc !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(input.exportedAtUtc) ||
      !Number.isFinite(Date.parse(input.exportedAtUtc)) ||
      !Array.isArray(input.tables) ||
      input.tables.length !== LEGACY_COVERAGE_SOURCES.length) {
    return fail("invalid_legacy_source_manifest");
  }
  const rows: SourceEvidenceTable[] = [];
  const seen = new Set<string>();
  for (const t of input.tables) {
    if (!obj(t) || typeof t.tableName !== "string" || Object.keys(t).some(k =>
      !["tableName","present","rowCount","columnCount","schemaSha256"].includes(k)))
      return fail("invalid_legacy_source_table");
    const key = t.tableName.toLowerCase();
    const allowed = known.get(key);
    if (!allowed || seen.has(key) || t.tableName !== allowed.tableName) {
      return fail("unexpected_or_duplicate_legacy_source_table");
    }
    seen.add(key);
    if (typeof t.present !== "boolean" || !Number.isSafeInteger(t.rowCount) ||
        !Number.isSafeInteger(t.columnCount) ||
        (t.rowCount as number) < 0 || (t.rowCount as number) > 10_000_000 ||
        (t.columnCount as number) < 0 || (t.columnCount as number) > 2_000 ||
        (t.present && ((t.columnCount as number) < 1 || !sha(t.schemaSha256))) ||
        (!t.present && (t.rowCount !== 0 || t.columnCount !== 0 ||
          t.schemaSha256 !== null))) {
      return fail("invalid_legacy_source_table_evidence");
    }
    rows.push({ tableName: allowed.tableName, present: t.present,
      rowCount: t.rowCount as number, columnCount: t.columnCount as number,
      schemaSha256: t.schemaSha256 as string | null });
  }
  return {
    schemaVersion: 1, evidenceType: LEGACY_COVERAGE_TYPE,
    sourceName: input.sourceName as string,
    sourceSha256: input.sourceSha256 as string,
    sourceBytes: input.sourceBytes as number,
    exportedAtUtc: input.exportedAtUtc as string,
    includesPatientData: false,
    tables: rows.sort((a,b) =>
      LEGACY_COVERAGE_SOURCES.findIndex(s=>s.tableName===a.tableName) -
      LEGACY_COVERAGE_SOURCES.findIndex(s=>s.tableName===b.tableName)),
  };
}

export function sourceCoverageFingerprint(input: LegacySourceCoverage): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export function compareLegacyCoverage(
  manifest: LegacySourceCoverage, groups: readonly StagedCoverageCount[],
  selectedBatchCount: number,
) {
  const staged = new Map<string, { total: number; imported: number; unresolved: number; skipped: number }>();
  for (const group of groups) {
    if (typeof group.entityType !== "string" || typeof group.status !== "string" ||
        !Number.isSafeInteger(group.count) || group.count < 0) {
      return fail("invalid_staged_coverage_group");
    }
    const item = staged.get(group.entityType) ?? { total:0, imported:0, unresolved:0, skipped:0 };
    item.total += group.count;
    if (group.status === "IMPORTED") item.imported += group.count;
    else if (group.status === "SKIPPED") item.skipped += group.count;
    else item.unresolved += group.count;
    staged.set(group.entityType,item);
  }
  const perTarget = new Map<string,number>();
  for (const row of manifest.tables) {
    const spec = known.get(row.tableName.toLowerCase())!;
    if (row.present && spec.mode === "STAGED") {
      perTarget.set(spec.target,(perTarget.get(spec.target) ?? 0) + row.rowCount);
    }
  }
  return manifest.tables.map(row => {
    const spec = known.get(row.tableName.toLowerCase())!;
    const stats = staged.get(spec.target) ?? { total:0, imported:0, unresolved:0, skipped:0 };
    let finding: string;
    if (!row.present) finding = "SOURCE_TABLE_NOT_FOUND";
    else if (row.rowCount === 0) finding = "SOURCE_TABLE_EMPTY";
    else if (spec.mode === "DIRECT") finding = "DIRECT_IMPORT_REQUIRES_PROVENANCE";
    else if (spec.mode === "MANUAL") finding = "MANUAL_MAPPING_REQUIRED";
    else if (selectedBatchCount === 0) finding = "NO_LINKED_STAGING_BATCHES";
    else if (stats.total < (perTarget.get(spec.target) ?? 0)) finding = "SOURCE_COUNT_EXCEEDS_STAGING_CANDIDATES";
    else if (stats.total > (perTarget.get(spec.target) ?? 0)) finding = "STAGING_CANDIDATES_EXCEED_SOURCE_COUNT";
    else finding = "COUNT_MATCH_NOT_ROW_PROOF";
    return {
      tableName:row.tableName, target:spec.target, mode:spec.mode,
      present:row.present, sourceRows:row.rowCount,
      stagedCandidates:spec.mode==="STAGED"?stats.total:null,
      stagedImported:spec.mode==="STAGED"?stats.imported:null,
      stagedUnresolved:spec.mode==="STAGED"?stats.unresolved:null,
      stagedSkipped:spec.mode==="STAGED"?stats.skipped:null,
      finding,
      verified:false, clinicalApproved:false, financialApproved:false,
    };
  });
}
