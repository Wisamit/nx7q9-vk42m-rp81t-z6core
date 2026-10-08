import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB serializes report version allocation and permits only one release claim per result revision", {timeout: 30000}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for MariaDB reporting integration");
  const uri = new URL(process.env.DATABASE_URL);
  const config = {
    host: uri.hostname,
    port: Number(uri.port || 3306),
    user: decodeURIComponent(uri.username),
    password: decodeURIComponent(uri.password),
    database: uri.pathname.slice(1),
  };
  const [setup, releasing, competing] = await Promise.all([
    mysql.createConnection(config), mysql.createConnection(config), mysql.createConnection(config),
  ]);
  const org=randomUUID(), branch=randomUUID(), user=randomUUID(), patient=randomUUID();
  const order=randomUUID(), testId=randomUUID(), item=randomUUID(), result=randomUUID(), report=randomUUID();
  const suffix=org.slice(0,8);
  const cleanup: Array<{sql:string; params:string[]}>=[];
  async function insert(sql:string, params:string[], undoSql:string, undoParams:string[]) {
    await setup.execute(sql,params);
    cleanup.unshift({sql:undoSql,params:undoParams});
  }
  try {
    await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"RR-"+suffix,"Report Release CI"],"DELETE FROM organizations WHERE id = ?",[org]);
    await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [branch,org,"RR-"+suffix,"Report CI Branch"],"DELETE FROM branches WHERE id = ?",[branch]);
    await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [user,org,"rr-"+suffix,"Report Release Actor"],"DELETE FROM users WHERE id = ?",[user]);
    await insert("INSERT INTO patients (id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [patient,org,"RR-"+suffix,"Report CI Patient","report ci patient"],"DELETE FROM patients WHERE id = ?",[patient]);
    await insert("INSERT INTO orders (id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
      [order,org,"RR-"+suffix,branch,patient,user],"DELETE FROM orders WHERE id = ?",[order]);
    await insert("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [testId,org,"RR-"+suffix,"Report CI Test"],"DELETE FROM lab_tests WHERE id = ?",[testId]);
    await insert("INSERT INTO order_items (id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES (?,?,?,?,?,'USD',NOW(3))",
      [item,order,testId,"RR-"+suffix,"Report CI Test"],"DELETE FROM order_items WHERE id = ?",[item]);
    await insert("INSERT INTO laboratory_results (id,organization_id,order_item_id,performing_branch_id,entered_by_user_id,status,validation_stage,updated_at) VALUES (?,?,?,?,?,'VERIFIED','COMPLETE',NOW(3))",
      [result,org,item,branch,user],"DELETE FROM laboratory_results WHERE id = ?",[result]);
    await insert("INSERT INTO diagnostic_reports (id,organization_id,order_id,updated_at) VALUES (?,?,?,NOW(3))",
      [report,org,order],"DELETE FROM diagnostic_reports WHERE id = ?",[report]);

    const [original] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT updated_at FROM laboratory_results WHERE id = ?",[result]);
    const revision=original[0]?.updated_at as Date;
    await releasing.beginTransaction();
    const [first] = await releasing.execute<mysql.ResultSetHeader>(
      `UPDATE laboratory_results SET status = 'RELEASED', updated_at = DATE_ADD(updated_at, INTERVAL 1 SECOND)
       WHERE id = ? AND organization_id = ? AND status = 'VERIFIED' AND validation_stage = 'COMPLETE' AND updated_at = ?`,
      [result,org,revision]);
    assert.equal(first.affectedRows,1);

    const [locked] = await releasing.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM diagnostic_reports WHERE id = ? AND organization_id = ? FOR UPDATE",[report,org]);
    assert.equal(locked.length,1);
    const firstVersion=randomUUID(), secondVersion=randomUUID();
    await releasing.execute(
      `INSERT INTO diagnostic_report_versions
      (id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id)
      VALUES (?,?,1,'PARTIAL',?,'{}','[]',?,?)`,
      [firstVersion,report,branch,"a".repeat(56)+suffix,user]);
    cleanup.unshift({sql:"DELETE FROM diagnostic_report_versions WHERE id = ?",params:[firstVersion]});

    await competing.query("SET SESSION innodb_lock_wait_timeout = 1");
    await competing.beginTransaction();
    await assert.rejects(
      competing.execute("SELECT id FROM diagnostic_reports WHERE id = ? FOR UPDATE",[report]),
      (error: unknown) => Boolean(error && typeof error==="object" && "code" in error && error.code==="ER_LOCK_WAIT_TIMEOUT"));
    await competing.rollback();
    await releasing.commit();

    await competing.beginTransaction();
    const [stale] = await competing.execute<mysql.ResultSetHeader>(
      `UPDATE laboratory_results SET status = 'RELEASED'
       WHERE id = ? AND organization_id = ? AND status = 'VERIFIED' AND validation_stage = 'COMPLETE' AND updated_at = ?`,
      [result,org,revision]);
    assert.equal(stale.affectedRows,0);

    const [secondLock]=await competing.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM diagnostic_reports WHERE id = ? AND organization_id = ? FOR UPDATE",[report,org]);
    assert.equal(secondLock.length,1);
    const [last]=await competing.execute<mysql.RowDataPacket[]>(
      "SELECT MAX(version) AS latest FROM diagnostic_report_versions WHERE report_id = ?",[report]);
    assert.equal(Number(last[0]?.latest),1);
    await competing.execute(
      `INSERT INTO diagnostic_report_versions
      (id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id)
      VALUES (?,?,2,'FINAL',?,'{}','[]',?,?)`,
      [secondVersion,report,branch,"b".repeat(56)+suffix,user]);
    cleanup.unshift({sql:"DELETE FROM diagnostic_report_versions WHERE id = ?",params:[secondVersion]});
    await competing.commit();

    const [history]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT version FROM diagnostic_report_versions WHERE report_id = ? ORDER BY version ASC",[report]);
    assert.deepEqual(history.map(row=>row.version),[1,2]);
    const [once]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM laboratory_results WHERE id = ?",[result]);
    assert.equal(once[0]?.status,"RELEASED");
  } finally {
    await Promise.all([releasing.rollback().catch(()=>{}),competing.rollback().catch(()=>{})]);
    for(const row of cleanup) await setup.execute(row.sql,row.params);
    await Promise.all([setup.end(),releasing.end(),competing.end()]);
  }
});
