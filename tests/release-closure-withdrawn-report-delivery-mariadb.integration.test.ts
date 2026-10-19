import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB: withdrawn or superseded report version cannot acquire a fresh print/PDF delivery event",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const config={host:uri.hostname,port:Number(uri.port||3306),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),database:uri.pathname.slice(1)};
  const [setup,operator,reviewer]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config),mysql.createConnection(config)]);
  const id={org:randomUUID(),branch:randomUUID(),user:randomUUID(),patient:randomUUID(),
    order:randomUUID(),report:randomUUID(),version:randomUUID(),second:randomUUID(),event:randomUUID()};
  const tag=id.org.slice(0,8),undo:Array<{sql:string;params:string[]}>=[],timeoutError=(error:unknown)=>
    Boolean(error&&typeof error==="object"&&"code"in error&&error.code==="ER_LOCK_WAIT_TIMEOUT");
  const put=async(sql:string,params:string[],undoSql:string,ids:string[])=>{
    await setup.execute(sql,params);undo.unshift({sql:undoSql,params:ids});
  };
  const lock=async(conn:typeof operator)=>{
    const [reports]=await conn.execute<mysql.RowDataPacket[]>(
      "SELECT current_version AS currentVersion FROM diagnostic_reports WHERE id=? AND organization_id=? FOR UPDATE",
      [id.report,id.org]);
    const [versions]=await conn.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM diagnostic_report_versions WHERE id=? AND report_id=? FOR UPDATE",
      [id.version,id.report]);
    return {currentVersion:reports[0]?.currentVersion,status:versions[0]?.status};
  };
  try{
    await put("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id.org,"WDR"+tag,"Synthetic withdrawn report"],"DELETE FROM organizations WHERE id=?",[id.org]);
    await put("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.branch,id.org,"WDR"+tag,"Synthetic report branch"],"DELETE FROM branches WHERE id=?",[id.branch]);
    await put("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.user,id.org,"wdr"+tag,"Synthetic lab operator"],"DELETE FROM users WHERE id=?",[id.user]);
    await put("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id.patient,id.org,"WDR"+tag,"Synthetic report patient","synthetic report patient"],
      "DELETE FROM patients WHERE id=?",[id.patient]);
    await put("INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [id.order,id.org,"WDR"+tag,id.branch,id.patient,id.user],
      "DELETE FROM orders WHERE id=?",[id.order]);
    await put("INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) VALUES(?,?,?,1,NOW(3))",
      [id.report,id.org,id.order],"DELETE FROM diagnostic_reports WHERE id=?",[id.report]);
    await put("INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id) VALUES(?,?,1,'FINAL',?,'{}','[]',?,?)",
      [id.version,id.report,id.branch,"wdr"+tag+"a".repeat(48),id.user],
      "DELETE FROM diagnostic_report_versions WHERE id=?",[id.version]);
    await operator.query("SET SESSION innodb_lock_wait_timeout=1");
    await reviewer.query("SET SESSION innodb_lock_wait_timeout=1");

    // A clinical retraction committed first must be observed and rejected
    // by the delivery transaction after waiting on the version's row lock.
    await reviewer.beginTransaction();
    await reviewer.execute("UPDATE diagnostic_report_versions SET status='RETRACTED' WHERE id=?",[id.version]);
    await operator.beginTransaction();
    await assert.rejects(()=>operator.execute(
      "SELECT status FROM diagnostic_report_versions WHERE id=? FOR UPDATE",[id.version]),timeoutError);
    await operator.rollback();
    await reviewer.commit();
    await operator.beginTransaction();
    assert.equal((await lock(operator)).status,"RETRACTED");
    await operator.rollback();
    const [before]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS c FROM report_delivery_events WHERE report_version_id=?",[id.version]);
    assert.equal(Number(before[0].c),0);

    // After a legitimate authorization and status check, a competing
    // retraction cannot race in before the event is transactionally logged.
    await setup.execute("UPDATE diagnostic_report_versions SET status='FINAL' WHERE id=?",[id.version]);
    await operator.beginTransaction();
    const current=await lock(operator);
    assert.equal(current.currentVersion,1);
    assert.equal(current.status,"FINAL");
    await reviewer.beginTransaction();
    await assert.rejects(()=>reviewer.execute(
      "UPDATE diagnostic_report_versions SET status='RETRACTED' WHERE id=?",[id.version]),timeoutError);
    await reviewer.rollback();
    const [created]=await operator.execute<mysql.ResultSetHeader>(
      "INSERT INTO report_delivery_events(id,report_version_id,channel,status,performed_by_user_id) VALUES(?,?,'PRINT','RECORDED',?)",
      [id.event,id.version,id.user]);
    assert.equal(created.affectedRows,1);
    undo.unshift({sql:"DELETE FROM report_delivery_events WHERE id=?",params:[id.event]});
    await operator.commit();
    const [recorded]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM report_delivery_events WHERE id=?",[id.event]);
    assert.equal(recorded[0].status,"RECORDED");

    // The next superseding version prevents additional events from a
    // stale staff page; the original immutable recorded event is retained.
    await put("INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id) VALUES(?,?,2,'AMENDED',?,'{}','[]',?,?)",
      [id.second,id.report,id.branch,"wdr"+tag+"b".repeat(48),id.user],
      "DELETE FROM diagnostic_report_versions WHERE id=?",[id.second]);
    await setup.execute("UPDATE diagnostic_reports SET current_version=2 WHERE id=?",[id.report]);
    await operator.beginTransaction();
    const stale=await lock(operator);
    assert.equal(stale.currentVersion,2);
    assert.equal(stale.status,"FINAL");
    await operator.rollback();
    const [after]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS c FROM report_delivery_events WHERE report_version_id=?",[id.version]);
    assert.equal(Number(after[0].c),1,"historical successful delivery must remain immutable");
  }finally{
    await Promise.all([operator.rollback().catch(()=>{}),reviewer.rollback().catch(()=>{})]);
    for(const row of undo)await setup.execute(row.sql,row.params).catch(()=>{});
    await Promise.all([setup.end(),operator.end(),reviewer.end()]);
  }
});
