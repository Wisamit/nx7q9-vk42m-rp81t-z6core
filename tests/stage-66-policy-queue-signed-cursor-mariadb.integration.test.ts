import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  issueSignedPolicyQueueCursor, verifySignedPolicyQueueCursor,
  samePolicyQueueAnchor, POLICY_QUEUE_CURSOR_TTL_MS,
} from "../src/lib/catalog-policy-queue-signed-cursor.ts";
import {
  createPolicyDraftLedgerEntry, policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";

test("Stage 66 MariaDB: two sessions invalidate a context-bound page after concurrent policy revision",{
  timeout:45000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),outside=randomUUID(),branch=randomUUID(),otherBranch=randomUUID();
  const author=randomUUID(),reviewer=randomUUID(),batch=randomUUID();
  const firstId=randomUUID(),secondId=randomUUID();
  const name="S66"+org.slice(0,8),checksum="b".repeat(64);
  const ctx={organizationId:org,branchId:branch,batchId:batch,sourceChecksum:checksum};
  const p=Object.fromEntries(policyKeys.map(k=>[k,"UNDECIDED"])) as CatalogPolicyProposal;
  const first=createPolicyDraftLedgerEntry(ctx,p,1);
  const second=createPolicyDraftLedgerEntry(ctx,{...p,branchDelegation:"BRANCH_SPECIFIC"},2);
  const scope={organizationId:org,branchId:branch,reviewerUserId:reviewer,
    secret:"stage66-test-key-".repeat(4)};
  const write=(q:string,args:Array<string|number|null>)=>writer.execute(q,args);
  const top=async()=>{
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,occurred_at FROM audit_events WHERE organization_id=? AND branch_id=? AND action='CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED' AND entity_type='CatalogImportBatch' ORDER BY occurred_at DESC,id DESC LIMIT 1",
      [org,branch]);
    return rows.length?{id:String(rows[0].id),occurredAt:new Date(rows[0].occurred_at)}:null;
  };
  try{
    for(const [id,c] of [[org,"A"],[outside,"X"]])await write(
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,name+c,"Stage66 Org"]);
    for(const [id,c] of [[branch,"A"],[otherBranch,"B"]])await write(
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id,org,name+c,"Stage66 Branch"]);
    for(const [id,c] of [[author,"A"],[reviewer,"R"]])await write(
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id,org,name+c,"Stage66 User"]);
    await write(
      "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage66.json',?,'DRAFT',?,NOW(3))",
      [batch,org,checksum,author]);
    await writer.beginTransaction();
    const [lock]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(lock.length,1);
    await writer.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,'2026-10-11 10:00:00.000')",
      [firstId,org,branch,author,batch,JSON.stringify(first)]);
    await writer.commit();
    const anchor=await top();
    assert.ok(anchor);
    assert.equal(anchor.id,firstId);
    const now=Date.now();
    const token=issueSignedPolicyQueueCursor({...scope,after:anchor,
      anchor,expiresAt:now+POLICY_QUEUE_CURSOR_TTL_MS});
    const current=verifySignedPolicyQueueCursor(token,scope,now);
    assert.ok(current);
    assert.equal(samePolicyQueueAnchor(current.anchor,await top()),true);
    assert.equal(verifySignedPolicyQueueCursor(token,
      {...scope,branchId:otherBranch},now),undefined);
    assert.equal(verifySignedPolicyQueueCursor(token,
      {...scope,organizationId:outside},now),undefined);

    // Author records another unsigned policy-draft revision on a second connection
    // between HTTP pages. The old reviewer cursor can no longer be continued.
    await writer.beginTransaction();
    const [locked]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(locked.length,1);
    await writer.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,'2026-10-11 11:00:00.000')",
      [secondId,org,branch,author,batch,JSON.stringify(second)]);
    await writer.commit();
    const newer=await top();
    assert.equal(newer?.id,secondId);
    assert.equal(samePolicyQueueAnchor(current.anchor,newer),false);
    const [unrelated]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_events WHERE organization_id=? AND entity_id=?",
      [outside,batch]);
    assert.equal(Number(unrelated[0].n),0);
    const [master]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(master[0].n),0);
    const [staged]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM catalog_import_rows WHERE batch_id=?",[batch]);
    assert.equal(Number(staged[0].n),0);
  }finally{
    await writer.rollback().catch(()=>{});
    await reader.rollback().catch(()=>{});
    await write("DELETE FROM audit_events WHERE id IN (?,?)",[firstId,secondId]).catch(()=>{});
    await write("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await write("DELETE FROM users WHERE id IN (?,?)",[author,reviewer]).catch(()=>{});
    await write("DELETE FROM branches WHERE id IN (?,?)",[branch,otherBranch]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id IN (?,?)",[org,outside]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
