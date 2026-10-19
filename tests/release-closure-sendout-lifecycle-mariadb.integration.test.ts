import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Release closure MariaDB: send-out CAS avoids duplicate or conflicting lifecycle events and custody reads", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [setup, first, second] = await Promise.all([
    mysql.createConnection(config), mysql.createConnection(config), mysql.createConnection(config),
  ]);
  const id = {
    org: randomUUID(), branch: randomUUID(), otherBranch: randomUUID(), user: randomUUID(),
    patient: randomUUID(), test: randomUUID(), order: randomUUID(), item: randomUUID(),
    lab: randomUUID(), specimen: randomUUID(), referral: randomUUID(), event: randomUUID(),
  };
  const suffix = id.org.slice(0, 8);
  const undo: Array<{ sql: string; params: string[] }> = [];
  async function insert(sql: string, params: string[], remove: string, ids: string[]) {
    await setup.execute(sql, params);
    undo.unshift({ sql: remove, params: ids });
  }
  const getReferral = async () => {
    const [rows] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM send_out_referrals WHERE id=?", [id.referral]);
    return rows[0]?.status;
  };
  try {
    await insert("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id.org, "RCL" + suffix, "Synthetic closure org"],
      "DELETE FROM organizations WHERE id=?", [id.org]);
    for (const [branch, code] of [[id.branch, "A"], [id.otherBranch, "B"]]) {
      await insert("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [branch,id.org,"RCL"+code+suffix,"Synthetic branch "+code],
        "DELETE FROM branches WHERE id=?", [branch]);
    }
    await insert("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.user,id.org,"rcl"+suffix,"Synthetic operator"],
      "DELETE FROM users WHERE id=?", [id.user]);
    await insert("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id.patient,id.org,"RCL"+suffix,"Synthetic Patient","synthetic patient"],
      "DELETE FROM patients WHERE id=?", [id.patient]);
    await insert("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.test,id.org,"RCL"+suffix,"Synthetic test"],
      "DELETE FROM lab_tests WHERE id=?", [id.test]);
    await insert("INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [id.order,id.org,"RCL"+suffix,id.branch,id.patient,id.user],
      "DELETE FROM orders WHERE id=?", [id.order]);
    await insert("INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
      [id.item,id.order,id.test,"RCL"+suffix,"Synthetic test"],
      "DELETE FROM order_items WHERE id=?", [id.item]);
    await insert("INSERT INTO external_laboratories(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id.lab,id.org,"RCL"+suffix,"Synthetic lab"],
      "DELETE FROM external_laboratories WHERE id=?", [id.lab]);
    await insert("INSERT INTO specimens(id,organization_id,order_id,barcode,sequence_number,status,current_branch_id,updated_at) VALUES(?,?,?,?,1,'RECEIVED',?,NOW(3))",
      [id.specimen,id.org,id.order,"RCL"+suffix,id.branch],
      "DELETE FROM specimens WHERE id=?", [id.specimen]);
    await insert("INSERT INTO specimen_order_items(specimen_id,order_item_id) VALUES(?,?)",
      [id.specimen,id.item],
      "DELETE FROM specimen_order_items WHERE specimen_id=? AND order_item_id=?",
      [id.specimen,id.item]);
    await insert("INSERT INTO send_out_referrals(id,organization_id,branch_id,order_item_id,specimen_id,external_laboratory_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,?,NOW(3))",
      [id.referral,id.org,id.branch,id.item,id.specimen,id.lab,id.user],
      "DELETE FROM send_out_referrals WHERE id=?", [id.referral]);
    await second.query("SET SESSION innodb_lock_wait_timeout=1");

    // Two independent staff actions read CREATED. Only the first one may
    // commit a transition and its corresponding event.
    await first.beginTransaction();
    const [firstClaim] = await first.execute<mysql.ResultSetHeader>(
      "UPDATE send_out_referrals SET status='DISPATCHED' WHERE id=? AND organization_id=? AND branch_id=? AND status='CREATED'",
      [id.referral,id.org,id.branch]);
    assert.equal(firstClaim.affectedRows,1);
    await first.execute(
      "INSERT INTO send_out_events(id,referral_id,from_status,to_status,actor_user_id) VALUES(?,?,'CREATED','DISPATCHED',?)",
      [id.event,id.referral,id.user]);
    undo.unshift({sql:"DELETE FROM send_out_events WHERE id=?",params:[id.event]});
    await second.beginTransaction();
    await assert.rejects(
      () => second.execute(
        "UPDATE send_out_referrals SET status='CANCELLED' WHERE id=? AND status='CREATED'",
        [id.referral]),
      (error: unknown) => Boolean(error && typeof error === "object" &&
        "code" in error && error.code === "ER_LOCK_WAIT_TIMEOUT"));
    await second.rollback();
    await first.commit();

    await second.beginTransaction();
    const [stale] = await second.execute<mysql.ResultSetHeader>(
      "UPDATE send_out_referrals SET status='CANCELLED' WHERE id=? AND status='CREATED'",
      [id.referral]);
    assert.equal(stale.affectedRows,0, "stale cancellation cannot rewrite dispatch");
    await second.rollback();
    assert.equal(await getReferral(),"DISPATCHED");
    const [events] = await setup.execute<mysql.RowDataPacket[]>(
      "SELECT from_status,to_status FROM send_out_events WHERE referral_id=?", [id.referral]);
    assert.deepEqual(events.map(x=>[x.from_status,x.to_status]),[["CREATED","DISPATCHED"]]);

    // A current-branch lock held by send-out creation forces a transfer to
    // serialize; a following creation sees the changed branch and no longer
    // qualifies under the original branch and READY status predicate.
    await first.beginTransaction();
    const [locked] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM specimens WHERE id=? FOR UPDATE", [id.specimen]);
    assert.equal(locked.length,1);
    await second.beginTransaction();
    await assert.rejects(
      () => second.execute("SELECT id FROM specimens WHERE id=? FOR UPDATE",[id.specimen]),
      (error: unknown) => Boolean(error && typeof error==="object" &&
        "code" in error && error.code==="ER_LOCK_WAIT_TIMEOUT"));
    await second.rollback();
    await first.execute(
      "UPDATE specimens SET current_branch_id=?,status='IN_TRANSIT',preanalytical_version=preanalytical_version+1 WHERE id=?",
      [id.otherBranch,id.specimen]);
    await first.commit();
    await second.beginTransaction();
    const [fresh] = await second.execute<mysql.RowDataPacket[]>(
      "SELECT current_branch_id,status FROM specimens WHERE id=? FOR UPDATE",[id.specimen]);
    assert.equal(fresh.length,1);
    assert.notEqual(fresh[0].current_branch_id,id.branch);
    assert.equal(fresh[0].status,"IN_TRANSIT");
    assert.equal(["COLLECTED","RECEIVED","IN_PROCESS"].includes(fresh[0].status),false);
    await second.rollback();
  } finally {
    await first.rollback().catch(()=>{});
    await second.rollback().catch(()=>{});
    for (const item of undo) await setup.execute(item.sql,item.params).catch(()=>{});
    await Promise.all([setup.end(),first.end(),second.end()]);
  }
});
