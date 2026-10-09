import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB: concurrent reference-range claims create one draft clinical interval, rollback frees claim", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [a,b] = await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),actor=randomUUID(),testId=randomUUID(),component=randomUUID();
  const batch=randomUUID(),row=randomUUID(), secondRow=randomUUID();
  const firstInterval=randomUUID(),secondInterval=randomUUID(),suffix=org.slice(0,8);
  const insert=async(sql:string,params: Array<string | number | null>)=>a.execute(sql,params);
  const claimSql="UPDATE catalog_import_rows SET status='IMPORTED' WHERE id=? AND batch_id=? AND status IN ('VALID','WARNING') AND imported_entity_id IS NULL";
  try {
    await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"CAS30-"+suffix,"Clinical CAS Organization"]);
    await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [actor,org,"cas30-"+suffix,"Clinical Reviewer"]);
    await insert("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [testId,org,"CAS30-"+suffix,"CAS Lab Test"]);
    await insert("INSERT INTO test_components (id,test_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [component,testId,"CAS30","CAS Component"]);
    await insert(
      "INSERT INTO catalog_import_batches (id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES (?,?,'LEGACY_MDB_EXPORT','clinical-cas.json','VALIDATED',?,NOW(3))",
      [batch,org,actor],
    );
    for (const [id,n] of [[row,1],[secondRow,2]] as const) {
      const source=JSON.stringify({testName:"CAS Lab Test",low:"70.125",high:"90.250"});
      await insert(
        "INSERT INTO catalog_import_rows (id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,?,'REFERENCE_INTERVAL','WARNING',?,?,NOW(3))",
        [id,batch,n,source,source],
      );
    }
    await a.beginTransaction();
    const [owned]=await a.execute<mysql.ResultSetHeader>(claimSql,[row,batch]);
    assert.equal(owned.affectedRows,1);
    // The second MariaDB connection starts while the first holds the row lock.
    const blocked=b.execute<mysql.ResultSetHeader>(claimSql,[row,batch]);
    await insert(
      "INSERT INTO reference_intervals (id,component_id,low_value,high_value,effective_from,approval_status,status,updated_at) VALUES (?,?,?,?,NOW(3),'DRAFT','INACTIVE',NOW(3))",
      [firstInterval,component,"70.125000","90.250000"],
    );
    await insert("UPDATE catalog_import_rows SET imported_entity_id=? WHERE id=?",
      [firstInterval,row]);
    await a.commit();
    const [late]=await blocked;
    assert.equal(late.affectedRows,0,"competing transaction cannot claim processed clinical row");
    const [intervals]=await b.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,approval_status,low_value FROM reference_intervals WHERE component_id=?",
      [component],
    );
    assert.equal(intervals.length,1);
    assert.equal(intervals[0].status,"INACTIVE");
    assert.equal(intervals[0].approval_status,"DRAFT");
    assert.equal(String(intervals[0].low_value),"70.125000");

    await a.beginTransaction();
    const [rollbackClaim]=await a.execute<mysql.ResultSetHeader>(claimSql,[secondRow,batch]);
    assert.equal(rollbackClaim.affectedRows,1);
    await a.rollback();
    const [recovered]=await b.execute<mysql.ResultSetHeader>(claimSql,[secondRow,batch]);
    assert.equal(recovered.affectedRows,1,"rolled-back row claim is available for retry");
    // A completed batch cannot be claimed by two safe-master writers.
    const batchSql="UPDATE catalog_import_batches SET status='IMPORTED',imported_at=NOW(3) WHERE id=? AND organization_id=? AND status='VALIDATED'";
    const [batchClaim]=await a.execute<mysql.ResultSetHeader>(batchSql,[batch,org]);
    const [duplicate]=await b.execute<mysql.ResultSetHeader>(batchSql,[batch,org]);
    assert.equal(batchClaim.affectedRows,1);
    assert.equal(duplicate.affectedRows,0);
    const [finalBatch]=await b.execute<mysql.RowDataPacket[]>(
      "SELECT status,imported_at FROM catalog_import_batches WHERE id=? AND organization_id=?",[batch,org]);
    assert.equal(finalBatch[0].status,"IMPORTED");
    assert.ok(finalBatch[0].imported_at);
  } finally {
    await a.rollback().catch(()=>{});
    await b.rollback().catch(()=>{});
    await insert("DELETE FROM catalog_import_rows WHERE batch_id=?",[batch]).catch(()=>{});
    await insert("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await insert("DELETE FROM reference_intervals WHERE id IN (?,?)",[firstInterval,secondInterval]).catch(()=>{});
    await insert("DELETE FROM test_components WHERE id=?",[component]).catch(()=>{});
    await insert("DELETE FROM lab_tests WHERE id=?",[testId]).catch(()=>{});
    await insert("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
    await insert("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([a.end(),b.end()]);
  }
});
