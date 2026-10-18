import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/**
 * The actual MariaDB composite predicate must recover only the original
 * author's batch; no other organization, actor or staging source may match.
 */
test("Stage 149 MariaDB: recovery key is author, tenant and source isolated", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const db = await mysql.createConnection({
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  });
  const orgA = randomUUID(), orgB = randomUUID();
  const author = randomUUID(), peer = randomUUID(), outsider = randomUUID();
  const key = randomUUID(), code = orgA.slice(0, 8);
  const ids: string[] = [];
  const execute = (sql: string, values: (string | null)[]) => db.execute(sql, values);
  async function batch(organization: string, actor: string, sourceType: string, name: string) {
    const id = randomUUID();
    await execute(
      "INSERT INTO catalog_import_batches(id, organization_id, source_type, source_name, source_checksum, submission_key, status, created_by_user_id, updated_at) VALUES(?,?,?,?,?,?,'DRAFT',?,NOW(3))",
      [id, organization, sourceType, name, "c".repeat(64), key, actor],
    );
    ids.push(id);
    return id;
  }
  try {
    for (const [id, suffix] of [[orgA, "A"], [orgB, "B"]]) {
      await execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id, "S149-" + code + suffix, "Synthetic recovery laboratory"]);
    }
    for (const [id, org, suffix] of [
      [author, orgA, "A"], [peer, orgA, "B"], [outsider, orgB, "C"],
    ]) {
      await execute("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id, org, "s149-" + code + suffix, "Synthetic catalog reviewer"]);
    }
    const original = await batch(orgA, author, "CSV_REVIEW", "source.csv");
    await batch(orgA, peer, "CSV_REVIEW", "peer.csv");
    await batch(orgA, author, "CONFIG_BUNDLE_REVIEW", "source.json");
    await batch(orgB, outsider, "CSV_REVIEW", "foreign.csv");

    async function lookup(org: string, actor: string, source: string, requestKey: string) {
      const [rows] = await db.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM catalog_import_batches WHERE organization_id=? AND created_by_user_id=? AND source_type=? AND submission_key=?",
        [org, actor, source, requestKey]);
      return rows.map(row => row.id as string);
    }
    assert.deepEqual(await lookup(orgA, author, "CSV_REVIEW", key), [original]);
    assert.deepEqual(await lookup(orgA, peer, "CSV_REVIEW", key) === [original], false);
    assert.deepEqual(await lookup(orgA, author, "CSV_REVIEW", randomUUID()), []);
    assert.deepEqual(await lookup(orgB, author, "CSV_REVIEW", key), []);
    assert.deepEqual(await lookup(orgA, author, "LEGACY_MDB_EXPORT", key), []);
    const [peerResult] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM catalog_import_batches WHERE organization_id=? AND created_by_user_id=? AND source_type=? AND submission_key=?",
      [orgA, peer, "CSV_REVIEW", key]);
    assert.equal(peerResult.length, 1);
    assert.notEqual(peerResult[0].id, original);
  } finally {
    if (ids.length) await execute(
      "DELETE FROM catalog_import_batches WHERE id IN (" + ids.map(() => "?").join(",") + ")", ids,
    ).catch(() => {});
    await execute("DELETE FROM users WHERE username LIKE ?", ["s149-" + code + "%"]).catch(() => {});
    await execute("DELETE FROM organizations WHERE id IN (?,?)", [orgA, orgB]).catch(() => {});
    await db.end();
  }
});
