import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  reviewStageBatchMetadata, sealReviewStageEvidence, verifyReviewStageEvidence,
  qualifiedIndependentReviewSource,
  type ReviewStageEvidenceContext,
} from "../src/lib/catalog-review-stage-evidence.ts";

test("F2 MariaDB: independently edited batch provenance or row evidence invalidates reviewer v2 seal", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const uri = new URL(process.env.DATABASE_URL);
  const cfg = { host: uri.hostname, port: Number(uri.port || 3306),
    user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password),
    database: uri.pathname.slice(1) };
  const [writer, reviewer] = await Promise.all([
    mysql.createConnection(cfg), mysql.createConnection(cfg),
  ]);
  const org = randomUUID(), author = randomUUID(), batch = randomUUID(), rowId = randomUUID();
  const sourceId = randomUUID(), code = "F2BM" + org.slice(0, 8);
  const secret = "synthetic-f2-batch-integrity-test-key-32bytes";
  const checksum = "c".repeat(64);
  const summary = {
    total: 1, WARNING: 1, reviewOnly: true,
    format: "family-lab-catalog-bundle", consistency: "transactional-consistent-read",
    attestationStatus: "VERIFIED", fieldContractStatus: "COMPLETE_SOURCE_FIELD_PROJECTION",
    exportedAt: "2026-10-20T00:00:00.000Z", counts: { TEST: 1 },
  };
  const original = { id: sourceId, code, nameEn: "Synthetic metadata test",
    departmentId: null, status: "ACTIVE" };
  const json = (value: unknown): Record<string, unknown> =>
    (typeof value === "string" ? JSON.parse(value) : value) as Record<string, unknown>;
  const write = (sql: string, params: Array<string | number | null>) => writer.execute(sql, params);
  const read = async () => {
    const [batches] = await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT source_type AS sourceType,source_name AS sourceName,status,summary FROM catalog_import_batches WHERE id=? AND organization_id=?",
      [batch, org]);
    const [rows] = await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id,`row_number` AS rowNumber,entity_type AS entityType,legacy_key AS legacyKey,status,source_data AS sourceData,normalized_data AS normalizedData,validation_issues AS validationIssues,imported_entity_id AS importedEntityId FROM catalog_import_rows WHERE batch_id=? ORDER BY `row_number`",
      [batch]);
    if (batches.length !== 1 || rows.length !== 1) throw Error("synthetic_batch_missing");
    const raw = json(batches[0].summary);
    const batchMetadata = reviewStageBatchMetadata({
      sourceType: String(batches[0].sourceType),
      sourceName: String(batches[0].sourceName),
      status: String(batches[0].status),
      summary: raw,
    });
    const stageRows = rows.map(row => ({
      id: String(row.id), rowNumber: Number(row.rowNumber),
      entityType: String(row.entityType), legacyKey: row.legacyKey as string | null,
      status: String(row.status), sourceData: json(row.sourceData),
      normalizedData: json(row.normalizedData),
      validationIssues: typeof row.validationIssues === "string"
        ? JSON.parse(row.validationIssues) : row.validationIssues,
      importedEntityId: row.importedEntityId as string | null,
    }));
    return { organizationId: org, batchId: batch, authorUserId: author,
      sourceChecksum: checksum, rows: stageRows, batchMetadata } as
      Omit<ReviewStageEvidenceContext, "batchMetadata"> &
      { batchMetadata: ReviewStageEvidenceContext["batchMetadata"] | null };
  };
  try {
    await write("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org, code + "O", "Synthetic metadata organization"]);
    await write("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [author, org, code + "U", "Synthetic author"]);
    await write("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,summary,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','sealed.json',?,'DRAFT',?,?,NOW(3))",
      [batch, org, checksum, author, JSON.stringify(summary)]);
    await write("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,legacy_key,source_data,normalized_data,validation_issues,updated_at) VALUES(?,?,1,'TEST','WARNING',?,?,?,?,NOW(3))",
      [rowId, batch, sourceId, JSON.stringify(original), JSON.stringify(original),
        JSON.stringify([{ severity: "WARNING", code: "CONFIGURATION_BUNDLE_REVIEW_ONLY" }])]);
    const originalRead = await read();
    assert.equal(originalRead.batchMetadata, null);
    const seal = sealReviewStageEvidence({
      ...originalRead, batchMetadata: {
        sourceType: "CONFIG_BUNDLE_REVIEW", sourceName: "sealed.json",
        status: "DRAFT", summary,
      },
    }, secret);
    assert.equal(seal.version, 2);
    await write("UPDATE catalog_import_batches SET summary=? WHERE id=?",
      [JSON.stringify({ ...summary, stageEvidenceSeal: seal }), batch]);
    const verify = async () => {
      const current = await read();
      return Boolean(current.batchMetadata && verifyReviewStageEvidence({
        ...current, batchMetadata: current.batchMetadata,
      }, json((await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT summary FROM catalog_import_batches WHERE id=?", [batch]))[0][0].summary)
        .stageEvidenceSeal, secret));
    };
    assert.equal(await verify(), true);
    assert.equal(qualifiedIndependentReviewSource((await read()).batchMetadata),true);
    // Re-sign unverified provenance with a valid key: post-staging integrity
    // still succeeds, but the separate qualification gate MUST refuse it.
    const untrusted={...summary,attestationStatus:"UNVERIFIED"};
    const untrustedSeal=sealReviewStageEvidence({
      ...(await read()),batchMetadata:{sourceType:"CONFIG_BUNDLE_REVIEW",
        sourceName:"sealed.json",status:"DRAFT",summary:untrusted},
    },secret);
    await write("UPDATE catalog_import_batches SET summary=? WHERE id=?",
      [JSON.stringify({...untrusted,stageEvidenceSeal:untrustedSeal}),batch]);
    assert.equal(await verify(),true);
    assert.equal(qualifiedIndependentReviewSource((await read()).batchMetadata),false);
    await write("UPDATE catalog_import_batches SET summary=? WHERE id=?",
      [JSON.stringify({...summary,stageEvidenceSeal:seal}),batch]);
    assert.equal(await verify(),true);
    await write("UPDATE catalog_import_batches SET summary=? WHERE id=?",
      [JSON.stringify({ ...summary, attestationStatus: "UNVERIFIED", stageEvidenceSeal: seal }), batch]);
    assert.equal(await verify(), false);
    await write("UPDATE catalog_import_batches SET summary=? WHERE id=?",
      [JSON.stringify({ ...summary, counts: { UNIT: 1 }, stageEvidenceSeal: seal }), batch]);
    assert.equal(await verify(), false);
    await write("UPDATE catalog_import_batches SET summary=? WHERE id=?",
      [JSON.stringify({ ...summary, stageEvidenceSeal: seal }), batch]);
    await write("UPDATE catalog_import_batches SET source_name=? WHERE id=?",
      ["renamed.json", batch]);
    assert.equal(await verify(), false);
    await write("UPDATE catalog_import_batches SET source_name=? WHERE id=?",
      ["sealed.json", batch]);
    await write("UPDATE catalog_import_rows SET normalized_data=? WHERE id=?",
      [JSON.stringify({ ...original, nameEn: "Tampered" }), rowId]);
    assert.equal(await verify(), false);
    await write("UPDATE catalog_import_rows SET normalized_data=? WHERE id=?",
      [JSON.stringify(original), rowId]);
    assert.equal(await verify(), true);
  } finally {
    await writer.execute("DELETE FROM catalog_import_rows WHERE batch_id=?", [batch]).catch(() => {});
    await writer.execute("DELETE FROM catalog_import_batches WHERE id=?", [batch]).catch(() => {});
    await writer.execute("DELETE FROM users WHERE id=?", [author]).catch(() => {});
    await writer.execute("DELETE FROM organizations WHERE id=?", [org]).catch(() => {});
    await Promise.all([writer.end(), reviewer.end()]);
  }
});
