import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB: portal contact revocation and corporate report grant revocation serialize with queuing", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const config={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [setup,queue,revoker]=await Promise.all([
    mysql.createConnection(config),mysql.createConnection(config),mysql.createConnection(config)]);
  const id={org:randomUUID(),patient:randomUUID(),client:randomUUID(),portal:randomUUID(),
    verification:randomUUID(),grant:randomUUID()};
  const suffix=id.org.slice(0,8);
  const undo:Array<{sql:string;params:string[]}>=[];
  async function put(sql:string,params:string[],undoSql:string,undoParams:string[]) {
    await setup.execute(sql,params);undo.unshift({sql:undoSql,params:undoParams});
  }
  const isTimeout=(e:unknown)=>Boolean(e&&typeof e==="object"&&"code"in e&&e.code==="ER_LOCK_WAIT_TIMEOUT");
  try {
    await put("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id.org,"ROC"+suffix,"Synthetic report consent"],"DELETE FROM organizations WHERE id=?",[id.org]);
    await put("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id.patient,id.org,"ROC"+suffix,"Synthetic recipient","synthetic recipient"],
      "DELETE FROM patients WHERE id=?",[id.patient]);
    await put("INSERT INTO clients(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.client,id.org,"ROC"+suffix,"Synthetic client"],"DELETE FROM clients WHERE id=?",[id.client]);
    await put("INSERT INTO portal_accounts(id,organization_id,type,patient_id,email,status,updated_at) VALUES(?,?,'PATIENT',?,?,'ACTIVE',NOW(3))",
      [id.portal,id.org,id.patient,"recipient@example.test"],
      "DELETE FROM portal_accounts WHERE id=?",[id.portal]);
    await put("INSERT INTO portal_contact_verifications(id,portal_account_id,channel,destination_snapshot,method,verification_reason,verified_at) VALUES(?,?,'EMAIL',?,'STAFF_CONFIRMED',?,NOW(3))",
      [id.verification,id.portal,"recipient@example.test","Synthetic consent"],
      "DELETE FROM portal_contact_verifications WHERE id=?",[id.verification]);
    await put("INSERT INTO corporate_portal_patient_access(id,client_id,patient_id,effective_from,can_view_reports,status,updated_at) VALUES(?,?,?,DATE_SUB(NOW(3), INTERVAL 1 DAY),1,'ACTIVE',NOW(3))",
      [id.grant,id.client,id.patient],
      "DELETE FROM corporate_portal_patient_access WHERE id=?",[id.grant]);

    await queue.query("SET SESSION innodb_lock_wait_timeout=1");
    await revoker.query("SET SESSION innodb_lock_wait_timeout=1");

    // Revocation commits first: a stale queue-time request must observe a
    // revoked verification under FOR UPDATE, not emit a notification.
    await revoker.beginTransaction();
    await revoker.execute("UPDATE portal_contact_verifications SET revoked_at=NOW(3) WHERE id=?", [id.verification]);
    await queue.beginTransaction();
    await assert.rejects(() => queue.execute(
      "SELECT id,revoked_at FROM portal_contact_verifications WHERE id=? FOR UPDATE",[id.verification]),isTimeout);
    await queue.rollback();
    await revoker.commit();
    await queue.beginTransaction();
    const [revoked]=await queue.execute<mysql.RowDataPacket[]>(
      "SELECT revoked_at FROM portal_contact_verifications WHERE id=? FOR UPDATE",[id.verification]);
    assert.ok(revoked[0].revoked_at,"new queued report must observe revoked contact");
    await queue.rollback();

    // A fresh verification can be held locked while preparing a queue event;
    // its revocation then waits until queue authorization commits.
    await setup.execute("UPDATE portal_contact_verifications SET revoked_at=NULL WHERE id=?",[id.verification]);
    await queue.beginTransaction();
    const [live]=await queue.execute<mysql.RowDataPacket[]>(
      "SELECT revoked_at FROM portal_contact_verifications WHERE id=? FOR UPDATE",[id.verification]);
    assert.equal(live[0].revoked_at,null);
    await revoker.beginTransaction();
    await assert.rejects(()=>revoker.execute(
      "UPDATE portal_contact_verifications SET revoked_at=NOW(3) WHERE id=?",[id.verification]),isTimeout);
    await revoker.rollback();
    await queue.rollback();

    // Corporate report grant deactivation is serialized by the same
    // explicit grant FOR UPDATE query used at enqueue-time.
    await queue.beginTransaction();
    const [grants]=await queue.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM corporate_portal_patient_access WHERE client_id=? AND patient_id=? AND status='ACTIVE' AND can_view_reports=1 FOR UPDATE",
      [id.client,id.patient]);
    assert.equal(grants.length,1);
    await revoker.beginTransaction();
    await assert.rejects(()=>revoker.execute(
      "UPDATE corporate_portal_patient_access SET can_view_reports=0 WHERE id=?",[id.grant]),isTimeout);
    await revoker.rollback();
    await queue.rollback();
    await setup.execute("UPDATE corporate_portal_patient_access SET can_view_reports=0 WHERE id=?",[id.grant]);
    const [inactive]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM corporate_portal_patient_access WHERE client_id=? AND patient_id=? AND status='ACTIVE' AND can_view_reports=1",
      [id.client,id.patient]);
    assert.equal(inactive.length,0);
  } finally {
    await queue.rollback().catch(()=>{});
    await revoker.rollback().catch(()=>{});
    for(const row of undo)await setup.execute(row.sql,row.params).catch(()=>{});
    await Promise.all([setup.end(),queue.end(),revoker.end()]);
  }
});
