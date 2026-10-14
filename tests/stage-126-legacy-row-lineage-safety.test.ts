import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LEGACY_ROW_LINEAGE_TYPE, LEGACY_ROW_LINEAGE_PAGE_SIZE,
  parseLegacyRowManifest, parseLegacyRowDecision,
  legacyLineageMappingAllowed, legacyLineageDomainPermission,
} from "../src/lib/catalog-legacy-row-lineage.ts";

const H = "a".repeat(64), K = "b".repeat(64), D = "c".repeat(64);
function manifest() {
  return {
    schemaVersion: 1, evidenceType: LEGACY_ROW_LINEAGE_TYPE,
    sourceName: "Family lab -test.mdb", sourceSha256: H, sourceBytes: 150585344,
    tableName: "normal", schemaSha256: K, digestKeyId: D,
    sourceRowCount: 2, chunkIndex: 0, chunkCount: 1,
    exportedAtUtc: "2026-10-14T10:00:00Z", includesPatientData: false,
    rows: [{ rowDigest: H, occurrence: 1 }, { rowDigest: H, occurrence: 2 }],
  };
}
test("Stage 126: deidentified canonical Access row digests identify duplicate occurrences", () => {
  const parsed = parseLegacyRowManifest(manifest());
  assert.equal(parsed.rows.length, 2);
  assert.notEqual(parsed.rows[0].occurrence, parsed.rows[1].occurrence);
  assert.equal(parsed.digestKeyId, D);
  assert.equal(LEGACY_ROW_LINEAGE_PAGE_SIZE, 500);
});
test("Stage 126: strict privacy/schema/shape/duplicate and patient-source rejection", () => {
  const good = manifest();
  for (const candidate of [
    { ...good, includesPatientData: true },
    { ...good, tableName: "ID" },
    { ...good, tableName: "result" },
    { ...good, tableName: "cbc" },
    { ...good, tableName: "password" },
    { ...good, sourceName: "C:/private/source.mdb" },
    { ...good, digestKeyId: "" },
    { ...good, sourceSha256: "A".repeat(64) },
    { ...good, rows: [{ rowDigest: H, occurrence: 1 }, { rowDigest: H, occurrence: 1 }] },
    { ...good, rows: [{ rowDigest: H, occurrence: 0 }] },
    { ...good, rows: [{ rowDigest: H, occurrence: 1, patientName: "PRIVATE" }] },
    { ...good, rows: [{ rowDigest: H, occurrence: 1 }], sourceRowCount: 0 },
    { ...good, rows: Array.from({ length: 501 }, () => ({ rowDigest: H, occurrence: 1 })) },
    { ...good, data: "no raw source values allowed" },
  ]) assert.throws(() => parseLegacyRowManifest(candidate));
});
test("Stage 126: mapping requires literal source/target and independent review transition", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const target = "00000000-0000-4000-8000-000000000002";
  const decision = {
    id, expectedRevision: 1, classification: "MAPPED", targetType: "REFERENCE_INTERVAL",
    targetId: target, batchId: null, importRowId: null, reason: "Explicit matching source row and interval evidence",
  };
  assert.equal(parseLegacyRowDecision(decision).classification, "MAPPED");
  assert.throws(() => parseLegacyRowDecision({ ...decision, targetId: null }));
  assert.throws(() => parseLegacyRowDecision({ ...decision, expectedRevision: -1 }));
  assert.throws(() => parseLegacyRowDecision({ ...decision, reason: "yes" }));
  assert.throws(() => parseLegacyRowDecision({ ...decision, classification: "CLINICAL_APPROVED" }));
  assert.throws(() => parseLegacyRowDecision({ ...decision, patientId: target }));
  assert.throws(() => parseLegacyRowDecision({ ...decision, importRowId: id, batchId: null }));
  assert.ok(legacyLineageMappingAllowed("normal", "REFERENCE_INTERVAL"));
  assert.ok(!legacyLineageMappingAllowed("normal", "PRICE_LIST_PACKAGE_ITEM"));
  assert.equal(legacyLineageDomainPermission("PRICE_LIST_PACKAGE_ITEM"), "pricing.manage");
  assert.equal(legacyLineageDomainPermission("REFERENCE_INTERVAL"), "catalog.reference_ranges.manage");
  assert.ok(legacyLineageMappingAllowed("Source", "CLIENT"));
  assert.ok(legacyLineageMappingAllowed("Referdby", "CLIENT"));
  assert.ok(legacyLineageMappingAllowed("price", "CONTRACT"));
  assert.ok(legacyLineageMappingAllowed("price", "PRICE_LIST"));
  assert.equal(legacyLineageDomainPermission("CONTRACT"), "pricing.manage");
  assert.ok(!legacyLineageMappingAllowed("normal", "CONTRACT"));
});
test("Stage 126: source fingerprint and mapping can never activate financial or clinical content", () => {
  const api = readFileSync("src/app/api/catalog/legacy-row-lineage/route.ts", "utf8");
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  const migration = readFileSync("prisma/migrations/20261014224500_legacy_catalog_row_lineage/migration.sql", "utf8");
  const exporter = readFileSync("scripts/legacy/export-row-lineage.ps1", "utf8");
  assert.match(api, /FOR UPDATE/);
  assert.match(api, /updateMany/);
  assert.match(api, /lineage_revision_conflict/);
  assert.match(api, /independent_mapping_reviewer_required/);
  assert.match(api, /sourceIndependentlyVerified: false/);
  assert.match(api, /clinicalApproved: false/);
  assert.match(api, /financialApproved: false/);
  assert.match(api, /activated: false/);
  assert.doesNotMatch(api, /tx\.(referenceInterval|priceListPackageItem|priceListItem|commercialPackageItem)\.create\(/);
  assert.doesNotMatch(api, /tx\.(referenceInterval|priceListPackageItem|priceListItem|commercialPackageItem)\.update\(/);
  assert.match(schema, /model LegacyCatalogRowLineage \{/);
  assert.match(migration, /FOREIGN KEY/);
  assert.match(exporter, /HMACSHA256/);
  assert.match(exporter, /Mode=Read/);
  assert.match(exporter, /\.partial\./);
  assert.doesNotMatch(exporter, /WriteAllText\([^\n]*\$reader/);
});
