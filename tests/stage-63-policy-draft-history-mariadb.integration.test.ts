import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  verifyPolicyDraftHistory, POLICY_DRAFT_HISTORY_LIMIT,
} from "../src/lib/catalog-policy-draft-history.ts";
import {
  createPolicyDraftLedgerEntry, policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";

test("Stage 63 MariaDB: two connections serialize revision append, detect corruption and preserve history", {
  timeout: 45000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [writer, reviewer] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), outside = randomUUID(), branch = randomUUID();
  const author = randomUUID(), intruder = randomUUID(), batch = randomUUID();
  // Physical descending UUID order is deliberately the reverse of revisions.
  const [id1,id2]=[randomUUID(),randomUUID()].sort((a,b)=>b.localeCompare(a));
  const badId=randomUUID();
  const label = "S63" + org.slice(0,8), checksum = "c".repeat(64);
  const policyScope = { organizationId: org, branchId: branch, batchId: batch, sourceChecksum: checksum };
  const proposal = Object.fromEntries(policyKeys.map(k=>[k,"UNDECIDED"])) as CatalogPolicyProposal;
  const first = createPolicyDraftLedgerEntry(policyScope, proposal, 1);
  const second = createPolicyDraftLedgerEntry(policyScope,
    { ...proposal, branchDelegation: "BRANCH_SPECIFIC" }, 2);
  const sql = (query: string, params: Array<string | number | null>) => writer.execute(query, params);
  const parse = (v: unknown) => typeof v === "string" ? JSON.parse(v) : v;
  const load = async() => {
    const [rows] = await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id,actor_user_id,new_values FROM audit_events WHERE organization_id=? AND branch_id=? AND action='CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED' AND entity_type='CatalogImportBatch' AND entity_id=? ORDER BY occurred_at DESC,id DESC LIMIT ?",
      [org,branch,batch,POLICY_DRAFT_HISTORY_LIMIT+1]);
    return verifyPolicyDraftHistory({
      ...policyScope, authorUserId: author, events: rows.map(r=>({
        id:String(r.id),actorUserId:r.actor_user_id as string | null,
        newValues:parse(r.new_values),
      })),
    });
  };
  try {
    for (const [id,code] of [[org,"A"],[outside,"O"]]) await sql(
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,label+code,"Stage63 Org"]);
    await sql("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,label+"B","Stage63 Branch"]);
    for(const [id,tenant,code] of [[author,org,"A"],[intruder,org,"I"]]) await sql(
      "INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
      [id,tenant,label+code,"Stage63 User"]);
    await sql(
      "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage63.json',?,'DRAFT',?,NOW(3))",
      [batch,org,checksum,author]);
    await writer.beginTransaction();
    const [lock]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(lock.length,1);
    await writer.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?)",
      [id1,org,branch,author,batch,JSON.stringify(first)]);
    await writer.commit();
    assert.equal((await load())?.revisionCount,1);

    await writer.beginTransaction();
    const [again]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(again.length,1);
    // Simulate stale browser compare-and-swap: revision 0 must not overwrite 1.
    assert.notEqual(0,(await load())?.draft?.revision);
    await writer.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,(SELECT occurred_at FROM (SELECT occurred_at FROM audit_events WHERE id=?) AS original))",
      [id2,org,branch,author,batch,JSON.stringify(second),id1]);
    await writer.commit();
    const [physical] = await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE id IN (?,?) ORDER BY occurred_at DESC,id DESC",[id1,id2]);
    assert.deepEqual(physical.map(row=>row.id),[id1,id2],
      "SQL UUID ordering must disagree with the signed revision sequence");
    const current=await load();
    assert.equal(current?.draft?.revision,2);
    assert.equal(current?.latestEventId,id2);
    assert.equal(current?.draft?.approved,false);
    assert.equal(current?.draft?.signingEnabled,false);

    const [outsideEvents]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE organization_id=? AND entity_id=?",[outside,batch]);
    assert.equal(outsideEvents.length,0);
    await sql(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,DATE_ADD(NOW(3),INTERVAL 2 SECOND))",
      [badId,org,branch,intruder,batch,JSON.stringify(createPolicyDraftLedgerEntry(policyScope, proposal,3))]);
    assert.equal(await load(),null);
    await sql("DELETE FROM audit_events WHERE id=?",[badId]);
    assert.equal((await load())?.revisionCount,2);
    const [masters]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(masters[0].count),0);
  } finally {
    await writer.rollback().catch(()=>{});
    await reviewer.rollback().catch(()=>{});
    await sql("DELETE FROM audit_events WHERE id IN (?,?,?)",[badId,id2,id1]).catch(()=>{});
    await sql("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await sql("DELETE FROM users WHERE id IN (?,?)",[author,intruder]).catch(()=>{});
    await sql("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await sql("DELETE FROM organizations WHERE id IN (?,?)",[org,outside]).catch(()=>{});
    await Promise.all([writer.end(),reviewer.end()]);
  }
});
