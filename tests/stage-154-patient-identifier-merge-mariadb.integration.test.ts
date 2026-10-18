import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/** Real two-connection MariaDB lock+identity tests, never production data. */
test("Stage154 MariaDB: patient merge/identifier operations share org lock, keep retired IDs and one live primary", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [first, second] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), otherOrg = randomUUID(),
    sourcePatient = randomUUID(), targetPatient = randomUUID(),
    scheme = randomUUID(), primary = randomUUID(), secondary = randomUUID();
  const tag = org.slice(0, 8);
  const tenantLock = async (conn: typeof first, tenant: string) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE", [tenant]);
    return rows;
  };
  const activePatient = async (conn: typeof first, patientId: string) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,merged_into_patient_id FROM patients " +
      "WHERE id=? AND organization_id=? AND status='ACTIVE' AND merged_into_patient_id IS NULL",
      [patientId,org]);
    return rows;
  };
  const activeIds = async (conn: typeof first) => {
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      "SELECT id,is_primary,status FROM patient_identifiers WHERE patient_id=? AND organization_id=? ORDER BY id",
      [sourcePatient,org]);
    return rows;
  };
  try {
    for (const [id,suffix] of [[org,"A"],[otherOrg,"B"]]) {
      await first.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S154"+tag+suffix,"Synthetic patient identity org"]);
    }
    for (const [id,suffix] of [[sourcePatient,"A"],[targetPatient,"B"]]) {
      await first.execute(
        "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) " +
        "VALUES(?,?,?,?,?,NOW(3))",
        [id,org,"S154-"+tag+"-"+suffix,"Synthetic patient "+suffix,"SYNTHETIC "+suffix]);
    }
    await first.execute(
      "INSERT INTO patient_identifier_schemes(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [scheme,org,"S154-"+tag,"Synthetic identifier"]);
    for (const [id,code,isPrimary] of [[primary,"PRIM",1],[secondary,"SECOND",0]] as const) {
      await first.execute(
        "INSERT INTO patient_identifiers(id,organization_id,patient_id,scheme_id,identifier_type," +
        "value,normalized_value,is_primary,updated_at) VALUES(?,?,?,?, 'OTHER',?,?,?,NOW(3))",
        [id,org,sourcePatient,scheme,code,code,isPrimary]);
    }
    await second.query("SET SESSION innodb_lock_wait_timeout=1");

    // Merge holds tenant lock. Identifier add or retirement cannot read stale
    // source=ACTIVE and then write after the merge has retired it.
    await first.beginTransaction();
    assert.equal((await tenantLock(first,org)).length,1);
    assert.equal((await activePatient(first,sourcePatient)).length,1);
    const [identitySnapshot] = await first.execute<mysql.RowDataPacket[]>(
      "SELECT id,is_primary FROM patient_identifiers WHERE patient_id=? AND status='ACTIVE' ORDER BY id",
      [sourcePatient]);
    assert.deepEqual(new Set(identitySnapshot.map(x=>x.id)), new Set([primary,secondary]));

    await second.beginTransaction();
    // An unrelated organization can still mutate independently.
    assert.equal((await tenantLock(second,otherOrg)).length,1);
    await second.rollback();
    await second.beginTransaction();
    await assert.rejects(() => tenantLock(second,org),
      (err: unknown) => Boolean(err && typeof err==="object" &&
        "code" in err && err.code==="ER_LOCK_WAIT_TIMEOUT"));
    await second.rollback();

    await first.execute(
      "UPDATE patients SET status='INACTIVE',merged_into_patient_id=?,merged_at=NOW(3)," +
      "deactivated_at=NOW(3),updated_at=NOW(3) WHERE id=? AND status='ACTIVE'",
      [targetPatient,sourcePatient]);
    await first.commit();

    await second.beginTransaction();
    assert.equal((await tenantLock(second,org)).length,1);
    assert.equal((await activePatient(second,sourcePatient)).length,0,
      "a source alias is never eligible for identifier mutation after merge");
    assert.equal((await activePatient(second,targetPatient)).length,1);
    await second.rollback();

    // Restore this synthetic patient and validate a primary retirement.
    await first.execute(
      "UPDATE patients SET status='ACTIVE',merged_into_patient_id=NULL,merged_at=NULL," +
      "deactivated_at=NULL,updated_at=NOW(3) WHERE id=?",
      [sourcePatient]);
    await first.beginTransaction();
    await tenantLock(first,org);
    const [primaryChange] = await first.execute<mysql.ResultSetHeader>(
      "UPDATE patient_identifiers SET status='INACTIVE',updated_at=NOW(3)" +
      " WHERE id=? AND patient_id=? AND organization_id=? AND status='ACTIVE'",
      [primary,sourcePatient,org]);
    assert.equal(primaryChange.affectedRows,1);
    const [secondaryChange] = await first.execute<mysql.ResultSetHeader>(
      "UPDATE patient_identifiers SET is_primary=1,updated_at=NOW(3)" +
      " WHERE id=? AND patient_id=? AND status='ACTIVE' AND is_primary=0",
      [secondary,sourcePatient]);
    assert.equal(secondaryChange.affectedRows,1);
    await first.commit();
    const ids = await activeIds(second);
    assert.equal(ids.filter(x=>x.status==="ACTIVE" && Number(x.is_primary)===1).length,1);
    assert.equal(ids.find(x=>x.id===secondary)?.is_primary,1);
    assert.equal(ids.find(x=>x.id===primary)?.status,"INACTIVE");

    // Inactive historical keys are intentionally not released. Even a
    // different patient cannot silently reuse a retired identifier value.
    await assert.rejects(() => second.execute(
      "INSERT INTO patient_identifiers(id,organization_id,patient_id,scheme_id,identifier_type," +
      "value,normalized_value,is_primary,updated_at) VALUES(?,?,?,?, 'OTHER',?,?,0,NOW(3))",
      [randomUUID(),org,targetPatient,scheme,"PRIM","PRIM"]),
      (err: unknown) => Boolean(err && typeof err==="object" &&
        "code" in err && err.code==="ER_DUP_ENTRY"));
  } finally {
    await first.rollback().catch(()=>{});
    await second.rollback().catch(()=>{});
    await first.execute("DELETE FROM patient_identifiers WHERE scheme_id=?", [scheme]).catch(()=>{});
    await first.execute("UPDATE patients SET merged_into_patient_id=NULL WHERE id=?", [sourcePatient]).catch(()=>{});
    await first.execute("DELETE FROM patients WHERE id IN (?,?)", [sourcePatient,targetPatient]).catch(()=>{});
    await first.execute("DELETE FROM patient_identifier_schemes WHERE id=?", [scheme]).catch(()=>{});
    await first.execute("DELETE FROM organizations WHERE id IN (?,?)", [org,otherOrg]).catch(()=>{});
    await Promise.all([first.end(),second.end()]);
  }
});
