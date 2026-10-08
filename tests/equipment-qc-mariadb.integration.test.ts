import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB QC resolution CAS, target serialization and equipment downtime locks", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [db, a, b] = await Promise.all([
    mysql.createConnection(config), mysql.createConnection(config), mysql.createConnection(config),
  ]);
  const id = () => randomUUID();
  const org = id(), branch = id(), user = id(), analyzer = id(), equipment = id();
  const labTest = id(), material = id(), lot = id(), target = id(), run = id(), violation = id();
  const target2 = id(), downtime = id();
  const suffix = org.slice(0, 8);
  const cleanup: Array<{ sql: string; values: string[] }> = [];

  async function seed(sql: string, values: string[], undo: string, undoValues: string[]) {
    await db.execute(sql, values);
    cleanup.unshift({ sql: undo, values: undoValues });
  }

  try {
    await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"EQ-"+suffix,"QC Integration"],"DELETE FROM organizations WHERE id=?",[org]);
    await seed("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [branch,org,"EQ-"+suffix,"QC Branch"],"DELETE FROM branches WHERE id=?",[branch]);
    await seed("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [user,org,"eq-"+suffix,"QC User"],"DELETE FROM users WHERE id=?",[user]);
    await seed("INSERT INTO analyzers(id,organization_id,branch_id,code,name,protocol,transport,updated_at) VALUES (?,?,?,?,?,'ASTM','TCP_CLIENT',NOW(3))",
      [analyzer,org,branch,"EQ-"+suffix,"QC Analyzer"],"DELETE FROM analyzers WHERE id=?",[analyzer]);
    await seed("INSERT INTO equipment(id,organization_id,branch_id,analyzer_id,asset_id,name,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
      [equipment,org,branch,analyzer,"EQ-"+suffix,"QC Equipment"],"DELETE FROM equipment WHERE id=?",[equipment]);
    await seed("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [labTest,org,"EQ-"+suffix,"QC Test"],"DELETE FROM lab_tests WHERE id=?",[labTest]);
    await seed("INSERT INTO qc_materials(id,organization_id,code,name_en,level_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [material,org,"EQ-"+suffix,"Control","Level 1"],"DELETE FROM qc_materials WHERE id=?",[material]);
    await seed("INSERT INTO qc_lots(id,organization_id,material_id,lot_number,updated_at) VALUES (?,?,?,?,NOW(3))",
      [lot,org,material,"LOT-"+suffix],"DELETE FROM qc_lots WHERE id=?",[lot]);
    await seed("INSERT INTO qc_targets(id,organization_id,qc_lot_id,analyzer_id,test_id,target_mean,target_sd,enabled_rules,effective_from,effective_to,updated_at) VALUES (?,?,?,?,?,100,2,'[\"1:3s\"]','2026-01-01','2026-12-31',NOW(3))",
      [target,org,lot,analyzer,labTest],"DELETE FROM qc_targets WHERE id=?",[target]);
    await seed("INSERT INTO qc_runs(id,organization_id,branch_id,analyzer_id,operator_user_id,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [run,org,branch,analyzer,user],"DELETE FROM qc_runs WHERE id=?",[run]);
    await seed("INSERT INTO qc_rule_violations(id,qc_run_id,target_id,rule_code,severity,details,updated_at) VALUES (?,?,?,'1:3s','BLOCK','{}',NOW(3))",
      [violation,run,target],"DELETE FROM qc_rule_violations WHERE id=?",[violation]);

    // Two operators attempting resolution must not both win or create two action/audit trails.
    await a.beginTransaction();
    const updateSql = "UPDATE qc_rule_violations SET status='RESOLVED',resolved_by_user_id=?,resolved_at=NOW(3) WHERE id=? AND status='OPEN'";
    const [first] = await a.execute<mysql.ResultSetHeader>(updateSql, [user,violation]);
    assert.equal(first.affectedRows, 1);
    await b.query("SET SESSION innodb_lock_wait_timeout = 1");
    await b.beginTransaction();
    await assert.rejects(b.execute(updateSql,[user,violation]),
      (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === "ER_LOCK_WAIT_TIMEOUT"));
    await b.rollback();
    await a.commit();
    const [duplicate] = await b.execute<mysql.ResultSetHeader>(updateSql, [user,violation]);
    assert.equal(duplicate.affectedRows, 0);

    // Analyzer parent-row locks serialize competing effective-dated target writes.
    const overlapSql = "SELECT id FROM qc_targets WHERE organization_id=? AND qc_lot_id=? AND analyzer_id=? AND test_id=? AND component_id IS NULL AND status='ACTIVE' AND effective_from <= ? AND (effective_to IS NULL OR effective_to >= ?)";
    await a.beginTransaction();
    await a.execute("SELECT id FROM analyzers WHERE id=? FOR UPDATE",[analyzer]);
    const [notOverlapping] = await a.execute<mysql.RowDataPacket[]>(overlapSql,[org,lot,analyzer,labTest,"2027-12-31","2027-01-01"]);
    assert.equal(notOverlapping.length, 0);
    await a.execute("INSERT INTO qc_targets(id,organization_id,qc_lot_id,analyzer_id,test_id,target_mean,target_sd,enabled_rules,effective_from,effective_to,updated_at) VALUES (?,?,?,?,?,100,2,'[\"1:3s\"]','2027-01-01','2027-12-31',NOW(3))",
      [target2,org,lot,analyzer,labTest]);
    cleanup.unshift({ sql: "DELETE FROM qc_targets WHERE id=?", values:[target2] });
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM analyzers WHERE id=? FOR UPDATE",[analyzer]),
      (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === "ER_LOCK_WAIT_TIMEOUT"));
    await b.rollback();
    await a.commit();
    await b.beginTransaction();
    await b.execute("SELECT id FROM analyzers WHERE id=? FOR UPDATE",[analyzer]);
    const [overlap] = await b.execute<mysql.RowDataPacket[]>(overlapSql,[org,lot,analyzer,labTest,"2027-12-31","2027-01-01"]);
    assert.equal(overlap.length, 1);
    await b.rollback();

    // An equipment lock likewise serializes downtime transitions before checking OPEN events.
    await a.beginTransaction();
    await a.execute("SELECT id FROM equipment WHERE id=? FOR UPDATE",[equipment]);
    await a.execute("INSERT INTO equipment_downtime(id,equipment_id,analyzer_id,started_at,reason,updated_at) VALUES (?,?,?,NOW(3),'CI outage',NOW(3))",[downtime,equipment,analyzer]);
    cleanup.unshift({ sql: "DELETE FROM equipment_downtime WHERE id=?", values:[downtime] });
    await a.execute("UPDATE equipment SET status='OUT_OF_SERVICE' WHERE id=?",[equipment]);
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM equipment WHERE id=? FOR UPDATE",[equipment]),
      (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === "ER_LOCK_WAIT_TIMEOUT"));
    await b.rollback();
    await a.commit();
    const [open] = await b.execute<mysql.RowDataPacket[]>("SELECT id FROM equipment_downtime WHERE equipment_id=? AND status='OPEN'",[equipment]);
    assert.equal(open.length,1);
    const [closed] = await b.execute<mysql.ResultSetHeader>("UPDATE equipment_downtime SET status='CLOSED', ended_at=NOW(3),resolution='Investigated' WHERE id=? AND status='OPEN'",[downtime]);
    assert.equal(closed.affectedRows,1);
    const [closedTwice] = await b.execute<mysql.ResultSetHeader>("UPDATE equipment_downtime SET status='CLOSED' WHERE id=? AND status='OPEN'",[downtime]);
    assert.equal(closedTwice.affectedRows,0);
    const [stillOut] = await db.execute<mysql.RowDataPacket[]>("SELECT status FROM equipment WHERE id=?",[equipment]);
    assert.equal(stillOut[0]?.status,"OUT_OF_SERVICE");
  } finally {
    await Promise.all([a.rollback().catch(()=>{}),b.rollback().catch(()=>{})]);
    for (const item of cleanup) await db.execute(item.sql,item.values);
    await Promise.all([a.end(),b.end(),db.end()]);
  }
});
