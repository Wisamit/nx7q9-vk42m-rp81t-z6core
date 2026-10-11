import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

type PlanRow = mysql.RowDataPacket & { key: string | null; Extra: string | null };
type AuditRow = mysql.RowDataPacket & { id: string; occurred_at: Date };
const indexName = "audit_events_policy_queue_scan_idx";
const draftAction = "CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED";
const reviewAction = "CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED";

test("Stage 68 MariaDB: index supports scoped draft/review counts and descending keyset while preserving events",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u = new URL(process.env.DATABASE_URL);
  const db=await mysql.createConnection({
    host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1),
  });
  const org=randomUUID(),otherOrg=randomUUID(),branch=randomUUID(),otherBranch=randomUUID();
  const serial="S68"+org.slice(0,8);
  const rows:Array<{id:string,organizationId:string,branchId:string,action:string,
    entityType:string,entityId:string,occurredAt:string}>=[];
  const add=(organizationId:string,branchId:string,action:string,entityType:string,
    entityId:string,time:string)=>{
    rows.push({id:randomUUID(),organizationId,branchId,action,entityType,entityId,
      occurredAt:time});
  };
  try{
    const [indexes]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT INDEX_NAME,COLUMN_NAME,SEQ_IN_INDEX FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='audit_events' AND INDEX_NAME=? ORDER BY SEQ_IN_INDEX",
      [indexName]);
    assert.deepEqual(indexes.map(r=>r.COLUMN_NAME),[
      "organization_id","branch_id","action","entity_type","occurred_at","id",
    ]);
    for (const [id,suffix] of [[org,"A"],[otherOrg,"Z"]]){
      await db.execute(
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,serial+suffix,"Stage68 Audit Index Test"]);
    }
    for (const [id,suffix] of [[branch,"A"],[otherBranch,"B"]]){
      await db.execute(
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,serial+suffix,"Stage68 Branch"]);
    }
    const b1=randomUUID(),b2=randomUUID(),b3=randomUUID();
    add(org,branch,draftAction,"CatalogImportBatch",b1,"2026-10-11 10:00:00.123");
    add(org,branch,draftAction,"CatalogImportBatch",b2,"2026-10-11 10:00:00.123");
    add(org,branch,draftAction,"CatalogImportBatch",b3,"2026-10-11 09:00:00.123");
    add(org,branch,reviewAction,"CatalogPolicyDraft",b1,"2026-10-11 09:30:00.123");
    add(org,branch,reviewAction,"CatalogPolicyDraft",b2,"2026-10-11 09:15:00.123");
    add(org,otherBranch,draftAction,"CatalogImportBatch",b1,"2026-10-11 12:00:00.123");
    add(org,branch,draftAction,"Specimen",b1,"2026-10-11 13:00:00.123");
    add(otherOrg,branch,draftAction,"CatalogImportBatch",b1,"2026-10-11 14:00:00.123");
    add(org,branch,"UNRELATED_AUDIT_ACTION","CatalogImportBatch",b2,"2026-10-11 11:00:00.123");
    const before=rows.map(row=>row.id).sort();
    // Every AuditEvent insert is within a scoped fixture. No clinical or financial
    // master records, patient identity or released result is inserted/updated.
    for(const e of rows){
      await db.execute(
        "INSERT INTO audit_events(id,organization_id,branch_id,action,entity_type,entity_id,occurred_at) VALUES(?,?,?,?,?,?,?)",
        [e.id,e.organizationId,e.branchId,e.action,e.entityType,e.entityId,e.occurredAt]);
    }
    const [draftPlan]=await db.execute<PlanRow[]>(
      "EXPLAIN SELECT id,occurred_at FROM audit_events FORCE INDEX (audit_events_policy_queue_scan_idx) WHERE organization_id=? AND branch_id=? AND action=? AND entity_type=? ORDER BY occurred_at DESC,id DESC LIMIT 101",
      [org,branch,draftAction,"CatalogImportBatch"]);
    const [reviewPlan]=await db.execute<PlanRow[]>(
      "EXPLAIN SELECT COUNT(*) FROM audit_events FORCE INDEX (audit_events_policy_queue_scan_idx) WHERE organization_id=? AND branch_id=? AND action=? AND entity_type=?",
      [org,branch,reviewAction,"CatalogPolicyDraft"]);
    assert.equal(draftPlan[0].key,indexName);
    assert.equal(reviewPlan[0].key,indexName);
    assert.match(String(draftPlan[0].Extra||""),/Using index/);
    assert.match(String(reviewPlan[0].Extra||""),/Using index/);

    const [drafts]=await db.execute<AuditRow[]>(
      "SELECT id,occurred_at FROM audit_events FORCE INDEX (audit_events_policy_queue_scan_idx) WHERE organization_id=? AND branch_id=? AND action=? AND entity_type=? ORDER BY occurred_at DESC,id DESC",
      [org,branch,draftAction,"CatalogImportBatch"]);
    assert.equal(drafts.length,3);
    const expected=rows.filter(x=>x.organizationId===org&&x.branchId===branch&&
      x.action===draftAction&&x.entityType==="CatalogImportBatch")
      .sort((x,y)=> y.occurredAt.localeCompare(x.occurredAt)||y.id.localeCompare(x.id));
    assert.deepEqual(drafts.map(x=>x.id),expected.map(x=>x.id));

    const cut=drafts[0];
    const [continued]=await db.execute<AuditRow[]>(
      "SELECT id,occurred_at FROM audit_events FORCE INDEX (audit_events_policy_queue_scan_idx) WHERE organization_id=? AND branch_id=? AND action=? AND entity_type=? AND (occurred_at<? OR (occurred_at=? AND id<?)) ORDER BY occurred_at DESC,id DESC LIMIT 101",
      [org,branch,draftAction,"CatalogImportBatch",
        cut.occurred_at,cut.occurred_at,cut.id]);
    assert.deepEqual(continued.map(x=>x.id),expected.slice(1).map(x=>x.id));
    const [reviewCounts]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_events FORCE INDEX (audit_events_policy_queue_scan_idx) WHERE organization_id=? AND branch_id=? AND action=? AND entity_type=?",
      [org,branch,reviewAction,"CatalogPolicyDraft"]);
    assert.equal(Number(reviewCounts[0].n),2);
    const [draftCounts]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_events FORCE INDEX (audit_events_policy_queue_scan_idx) WHERE organization_id=? AND branch_id=? AND action=? AND entity_type=?",
      [org,branch,draftAction,"CatalogImportBatch"]);
    assert.equal(Number(draftCounts[0].n),3);
    const [stored]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE id IN ("+rows.map(()=>"?").join(",")+")",
      rows.map(x=>x.id));
    assert.deepEqual(stored.map(x=>x.id).sort(),before);
    const [noMaster]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(noMaster[0].n),0);
  } finally {
    await db.execute("DELETE FROM audit_events WHERE id IN ("+rows.map(()=>"?").join(",")+")",
      rows.map(x=>x.id)).catch(()=>{});
    await db.execute("DELETE FROM branches WHERE id IN (?,?)",[branch,otherBranch]).catch(()=>{});
    await db.execute("DELETE FROM organizations WHERE id IN (?,?)",[org,otherOrg]).catch(()=>{});
    await db.end();
  }
});
