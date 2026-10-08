import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/**
 * Exercises the real InnoDB specimen-lock and result-revision CAS used in
 * technical/medical validation. Source-level tests separately check that both
 * HTTP handlers take these steps before creating any review or audit records.
 */
test("MariaDB serializes result validation against specimen custody and stale revisions", { timeout: 30000 }, async () => {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for the MariaDB integration test");
  const uri = new URL(url);
  const config = {
    host: uri.hostname, port: Number(uri.port || 3306), database: uri.pathname.slice(1),
    user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password),
  };
  const [setup, reviewerA, reviewerB] = await Promise.all([
    mysql.createConnection(config), mysql.createConnection(config), mysql.createConnection(config),
  ]);
  const org = randomUUID(), branch = randomUUID(), user = randomUUID(), patient = randomUUID();
  const order = randomUUID(), testId = randomUUID(), orderItem = randomUUID();
  const specimen = randomUUID(), result = randomUUID(), suffix = org.slice(0, 8);
  const cleanup: Array<{sql: string; args: string[]}> = [];
  async function insert(sql: string, args: string[], deleteSql: string, deleteArgs: string[]) {
    await setup.execute(sql, args);
    cleanup.unshift({sql: deleteSql, args: deleteArgs});
  }
  try {
    await insert("INSERT INTO organizations (id, code, name_en, updated_at) VALUES (?,?,?,NOW(3))",
      [org,"RV-"+suffix,"Result Validation CI"],"DELETE FROM organizations WHERE id = ?",[org]);
    await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [branch,org,"RV-"+suffix,"Validation Branch"],"DELETE FROM branches WHERE id = ?",[branch]);
    await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [user,org,"rv-"+suffix,"Validation Reviewer"],"DELETE FROM users WHERE id = ?",[user]);
    await insert("INSERT INTO patients (id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [patient,org,"RV-"+suffix,"Validation Patient","validation patient"],"DELETE FROM patients WHERE id = ?",[patient]);
    await insert("INSERT INTO orders (id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
      [order,org,"RV-"+suffix,branch,patient,user],"DELETE FROM orders WHERE id = ?",[order]);
    await insert("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [testId,org,"RV-"+suffix,"Validation Test"],"DELETE FROM lab_tests WHERE id = ?",[testId]);
    await insert("INSERT INTO order_items (id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES (?,?,?,?,?,'USD',NOW(3))",
      [orderItem,order,testId,"RV-"+suffix,"Validation Test"],"DELETE FROM order_items WHERE id = ?",[orderItem]);
    await insert("INSERT INTO specimens (id,organization_id,order_id,barcode,sequence_number,status,current_branch_id,updated_at) VALUES (?,?,?,?,1,'IN_PROCESS',?,NOW(3))",
      [specimen,org,order,"BAR-"+suffix,branch],"DELETE FROM specimens WHERE id = ?",[specimen]);
    await insert("INSERT INTO laboratory_results (id,organization_id,order_item_id,specimen_id,performing_branch_id,entered_by_user_id,status,validation_stage,updated_at) VALUES (?,?,?,?,?,?,'ENTERED','MEDICAL_VALIDATION',NOW(3))",
      [result,org,orderItem,specimen,branch,user],"DELETE FROM laboratory_results WHERE id = ?",[result]);

    const [initial] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT updated_at FROM laboratory_results WHERE id = ?",[result]);
    const initialRevision = initial[0]?.updated_at as Date;

    await reviewerA.beginTransaction();
    const [lockedCustody] = await reviewerA.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,current_branch_id FROM specimens WHERE id = ? AND organization_id = ? FOR UPDATE",
      [specimen,org]);
    assert.equal(lockedCustody.length,1);
    assert.equal(lockedCustody[0]?.status,"IN_PROCESS");
    assert.equal(lockedCustody[0]?.current_branch_id,branch);

    await reviewerB.query("SET SESSION innodb_lock_wait_timeout = 1");
    await reviewerB.beginTransaction();
    await assert.rejects(
      reviewerB.execute("SELECT id,status,current_branch_id FROM specimens WHERE id = ? FOR UPDATE",[specimen]),
      (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT"));
    await reviewerB.rollback();

    const [approved] = await reviewerA.execute<mysql.ResultSetHeader>(
      `UPDATE laboratory_results
       SET status = 'VERIFIED', validation_stage = 'COMPLETE', updated_at = DATE_ADD(updated_at,INTERVAL 1 SECOND)
       WHERE id = ? AND organization_id = ? AND status = 'ENTERED' AND validation_stage = 'MEDICAL_VALIDATION'
         AND updated_at = ?`,
      [result,org,initialRevision]);
    assert.equal(approved.affectedRows,1);
    await reviewerA.commit();

    await reviewerB.beginTransaction();
    const [secondCustody] = await reviewerB.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,current_branch_id FROM specimens WHERE id = ? AND organization_id = ? FOR UPDATE",
      [specimen,org]);
    assert.equal(secondCustody.length,1);
    const [staleAttempt] = await reviewerB.execute<mysql.ResultSetHeader>(
      `UPDATE laboratory_results
       SET status = 'VERIFIED', validation_stage = 'COMPLETE'
       WHERE id = ? AND organization_id = ? AND status = 'ENTERED' AND validation_stage = 'MEDICAL_VALIDATION'
         AND updated_at = ?`,
      [result,org,initialRevision]);
    assert.equal(staleAttempt.affectedRows,0);
    await reviewerB.rollback();

    const [stable] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status,validation_stage FROM laboratory_results WHERE id = ?",[result]);
    assert.equal(stable[0]?.status,"VERIFIED");
    assert.equal(stable[0]?.validation_stage,"COMPLETE");

    await reviewerA.beginTransaction();
    const [held] = await reviewerA.execute<mysql.ResultSetHeader>(
      "UPDATE specimens SET status = 'QUARANTINED', preanalytical_version = preanalytical_version + 1 WHERE id = ? AND status = 'IN_PROCESS'",
      [specimen]);
    assert.equal(held.affectedRows,1);
    const [unsafe] = await reviewerA.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,current_branch_id FROM specimens WHERE id = ? AND organization_id = ? FOR UPDATE",[specimen,org]);
    assert.equal(unsafe[0]?.status,"QUARANTINED");
    await reviewerA.rollback();
  } finally {
    await Promise.all([reviewerA.rollback().catch(()=>{}),reviewerB.rollback().catch(()=>{})]);
    for (const row of cleanup) await setup.execute(row.sql,row.args);
    await Promise.all([setup.end(),reviewerA.end(),reviewerB.end()]);
  }
});
