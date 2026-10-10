import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  createPolicyDraftLedgerEntry, readPolicyDraftLedgerEntry,
  policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";

test("Stage 59 MariaDB: append-only draft revisions preserve original audit, tenant, branch and CAS", {
  timeout: 45000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = {host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [author, inspector] = await Promise.all([
    mysql.createConnection(cfg), mysql.createConnection(cfg),
  ]);
  const org=randomUUID(), foreignOrg=randomUUID(), branch=randomUUID(),
    authorId=randomUUID(), foreignUser=randomUUID(), batch=randomUUID(),
    event1=randomUUID(), event2=randomUUID();
  const prefix="S59"+org.slice(0,8);
  const ctx={organizationId:org, branchId:branch, batchId:batch, sourceChecksum:"a".repeat(64)};
  const initial = Object.fromEntries(
    policyKeys.map(key => [key,"UNDECIDED"]),
  ) as CatalogPolicyProposal;
  const changed={...initial,clinicalAuthority:"MEDICAL_DIRECTOR"} as CatalogPolicyProposal;
  const write=(sql:string,args:Array<string|number|null>)=>author.execute(sql,args);
  try {
    for(const [id,suffix] of [[org,"A"],[foreignOrg,"B"]])
      await write("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+suffix,"Stage59 Organization"]);
    await write("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,prefix+"B","Stage59 Branch"]);
    for(const [id,tenant,suffix] of [[authorId,org,"A"],[foreignUser,foreignOrg,"F"]])
      await write("INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
        [id,tenant,prefix+suffix,"Stage59 User"]);
    await write("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage59.json',?,'DRAFT',?,NOW(3))",
      [batch,org,ctx.sourceChecksum,authorId]);

    const draft1=createPolicyDraftLedgerEntry(ctx,initial,1);
    await author.beginTransaction();
    const [lock]=await author.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(lock.length,1);
    await author.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?)",
      [event1,org,branch,authorId,batch,JSON.stringify(draft1)],
    );
    await author.commit();

    await inspector.beginTransaction();
    const [fresh]=await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]);
    assert.equal(fresh.length,1);
    const [last]=await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT id,new_values FROM audit_events WHERE organization_id=? AND branch_id=? AND actor_user_id=? AND entity_type='CatalogImportBatch' AND entity_id=? AND action='CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED' ORDER BY occurred_at DESC,id DESC LIMIT 1",
      [org,branch,authorId,batch]);
    assert.equal(last.length,1);
    const value=typeof last[0].new_values==="string"
      ? JSON.parse(last[0].new_values) : last[0].new_values;
    const observed=readPolicyDraftLedgerEntry(value,ctx);
    assert.equal(observed?.revision,1);
    assert.equal(observed?.approved,false);
    assert.equal(observed?.signingEnabled,false);
    assert.equal(observed?.activated,false);
    assert.equal(observed?.liveWrites,false);
    assert.equal(readPolicyDraftLedgerEntry(value,{...ctx,organizationId:foreignOrg}),null);
    // Old browser expectedRevision=0 is not permitted to append revision 2.
    const staleExpectedRevision=0;
    assert.notEqual(staleExpectedRevision,observed?.revision);
    await inspector.commit();

    const draft2=createPolicyDraftLedgerEntry(ctx,changed,2);
    await write(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,DATE_ADD(NOW(3), INTERVAL 1 SECOND))",
      [event2,org,branch,authorId,batch,JSON.stringify(draft2)],
    );

    const [history]=await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT id,new_values FROM audit_events WHERE organization_id=? AND entity_id=? AND action='CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED' ORDER BY occurred_at ASC,id ASC",
      [org,batch]);
    assert.equal(history.length,2);
    const first=typeof history[0].new_values==="string"
      ? JSON.parse(history[0].new_values) : history[0].new_values;
    const second=typeof history[1].new_values==="string"
      ? JSON.parse(history[1].new_values) : history[1].new_values;
    assert.equal(readPolicyDraftLedgerEntry(first,ctx)?.revision,1);
    assert.equal(readPolicyDraftLedgerEntry(second,ctx)?.revision,2);
    assert.equal(first.proposal.clinicalAuthority,"UNDECIDED");
    assert.equal(second.proposal.clinicalAuthority,"MEDICAL_DIRECTOR");
    assert.notEqual(first.proposalDigest,second.proposalDigest);
    const [foreignVisible]=await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE organization_id=? AND entity_id=?",
      [foreignOrg,batch]);
    assert.equal(foreignVisible.length,0);
    const [clinicalMutations]=await inspector.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(clinicalMutations[0].n),0);
  } finally {
    await author.rollback().catch(()=>{});
    await inspector.rollback().catch(()=>{});
    await write("DELETE FROM audit_events WHERE id IN (?,?)",[event2,event1]).catch(()=>{});
    await write("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await write("DELETE FROM users WHERE id IN (?,?)",[authorId,foreignUser]).catch(()=>{});
    await write("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    await Promise.all([author.end(),inspector.end()]);
  }
});
