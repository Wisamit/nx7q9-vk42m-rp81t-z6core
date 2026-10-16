import {
  LEGACY_COVERAGE_SOURCES, type LegacySourceCoverage,
} from "./legacy-source-coverage.ts";
import {
  LEGACY_ROW_LINEAGE_PAGE_SIZE, type LegacyRowManifest,
} from "./catalog-legacy-row-lineage.ts";

export class LegacyEvidencePackageError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}

function fail(code: string): never { throw new LegacyEvidencePackageError(code); }

type SourceIdentity = Pick<LegacySourceCoverage,
  "sourceName" | "sourceSha256" | "sourceBytes">;

/**
 * Metadata consistency only. These claims do NOT validate the Access rows,
 * independent HMAC derivation, clinical mapping or financial migration.
 */
export function verifyLegacyEvidenceManifestPackage(input: {
  source: SourceIdentity;
  coverage: LegacySourceCoverage;
  lineage: readonly LegacyRowManifest[];
  replayedLineage?: readonly LegacyRowManifest[];
}) {
  const { source, coverage, lineage } = input;
  for (const key of ["sourceName", "sourceSha256", "sourceBytes"] as const) {
    if (source[key] !== coverage[key])
      fail("legacy_evidence_source_mismatch");
  }
  if (coverage.tables.length !== LEGACY_COVERAGE_SOURCES.length)
    fail("legacy_evidence_coverage_incomplete");
  if (lineage.length > 6000) fail("legacy_evidence_too_many_pages");
  const tables = new Map<string, LegacyRowManifest[]>();
  let digestKeyId: string | null = null;

  for (const page of lineage) {
    for (const key of ["sourceName", "sourceSha256", "sourceBytes"] as const) {
      if (page[key] !== source[key])
        fail("legacy_evidence_cross_source_page");
    }
    if (digestKeyId && digestKeyId !== page.digestKeyId)
      fail("legacy_evidence_key_changed");
    digestKeyId = page.digestKeyId;
    const pages = tables.get(page.tableName) ?? [];
    if (pages.some(existing => existing.chunkIndex === page.chunkIndex))
      fail("legacy_evidence_duplicate_chunk");
    pages.push(page);
    tables.set(page.tableName, pages);
  }

  let totalRows = 0;
  const reviewTables = [];
  for (const expected of LEGACY_COVERAGE_SOURCES) {
    const item = coverage.tables.find(t => t.tableName === expected.tableName);
    if (!item) fail("legacy_evidence_coverage_incomplete");
    const count = item.present ? item.rowCount : 0;
    if (count > 200_000) fail("legacy_evidence_exporter_row_limit");
    const pages = tables.get(item.tableName) ?? [];
    const expectedPageCount = item.present
      ? Math.max(1, Math.ceil(count / LEGACY_ROW_LINEAGE_PAGE_SIZE)) : 0;
    if (pages.length !== expectedPageCount)
      fail("legacy_evidence_missing_or_extra_page");
    pages.sort((a, b) => a.chunkIndex - b.chunkIndex);
    let previousDigest = "", occurrence = 0, received = 0;
    for (let index = 0; index < pages.length; index++) {
      const page = pages[index];
      if (page.chunkIndex !== index || page.chunkCount !== expectedPageCount ||
          page.tableName !== expected.tableName ||
          page.schemaSha256 !== item.schemaSha256 ||
          page.sourceRowCount !== count)
        fail("legacy_evidence_page_schema_or_index_mismatch");
      const expectedLength = Math.min(
        LEGACY_ROW_LINEAGE_PAGE_SIZE, count - index * LEGACY_ROW_LINEAGE_PAGE_SIZE);
      if (page.rows.length !== expectedLength)
        fail("legacy_evidence_page_not_complete");
      for (const row of page.rows) {
        if (row.rowDigest === previousDigest) {
          if (row.occurrence !== occurrence + 1)
            fail("legacy_evidence_duplicate_occurrence_gap");
        } else {
          if (row.occurrence !== 1 || previousDigest &&
              row.rowDigest <= previousDigest)
            fail("legacy_evidence_digest_sort_order");
        }
        previousDigest = row.rowDigest;
        occurrence = row.occurrence;
        received++;
      }
    }
    if (received !== count) fail("legacy_evidence_count_mismatch");
    totalRows += received;
    reviewTables.push({
      tableName: expected.tableName, present: item.present,
      sourceRows: count, checkedPages: pages.length,
    });
  }
  if (tables.size !== reviewTables.filter(t => t.present).length)
    fail("legacy_evidence_unknown_table");
  // A separate Windows ACE replay can re-extract each original row using the
  // identical private HMAC key. It is still a SAME-IMPLEMENTATION re-read,
  // not independent proof of source values, mapping, or clinical correctness.
  let aceReplayMatches = false;
  if (input.replayedLineage !== undefined) {
    verifyLegacyEvidenceManifestPackage({
      source, coverage, lineage: input.replayedLineage,
    });
    const replay = new Map(input.replayedLineage.map(page => [
      page.tableName + ":" + page.chunkIndex, page,
    ]));
    if (replay.size !== lineage.length)
      fail("legacy_replay_page_count_mismatch");
    for (const original of lineage) {
      const fresh = replay.get(original.tableName + ":" + original.chunkIndex);
      if (!fresh || fresh.digestKeyId !== original.digestKeyId ||
          fresh.rows.length !== original.rows.length ||
          fresh.schemaSha256 !== original.schemaSha256)
        fail("legacy_replay_page_metadata_mismatch");
      for (let index = 0; index < original.rows.length; index++) {
        const expected = original.rows[index];
        const actual = fresh.rows[index];
        if (expected.rowDigest !== actual.rowDigest ||
            expected.occurrence !== actual.occurrence)
          fail("legacy_replay_row_hmac_mismatch");
      }
    }
    aceReplayMatches = true;
  }
  return {
    status: aceReplayMatches
      ? "ACE_HMAC_REPLAY_MATCHED_REVIEW_ONLY" as const
      : "METADATA_CONSISTENT_REVIEW_ONLY" as const,
    sourceSha256: source.sourceSha256, sourceBytes: source.sourceBytes,
    sourceName: source.sourceName,
    digestKeyId,
    masterRows: totalRows,
    tables: reviewTables,
    sourceHmacAceReplayMatches: aceReplayMatches,
    sourceHmacIndependentlyVerified: false as const,
    targetMappingCertified: false as const,
    clinicalApproved: false as const,
    financialApproved: false as const,
    cutoverApproved: false as const,
  };
}
