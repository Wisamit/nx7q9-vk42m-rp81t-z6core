import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage155 MariaDB: scheme disable and patient registration serialize both ways across branches", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = { host:url.hostname, port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1) };
  const [admin,staff] = await Promise.all([
    mysql.createConnection(config),mysql.createConnection(config),
  ]);
  const org=randomUUID(),foreignOrg=randomUUID(),
    disabledFirst=randomUUID(),registeredFirst=randomUUID(),
    patient=randomUUID(),identifier=randomUUID();
  const code="S155"+org.slice(0,8);
  const lock = async (conn:typeof admin,tenant:string) => {
    const [rows]=await conn.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[tenant]);
    return rows;
  };
  const activeScheme = async (conn:typeof admin,id:string) => {
    const [rows]=await conn.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM patient_identifier_schemes WHERE id=? AND organization_id=? AND status='ACTIVE'",
      [id,org]);
    return rows;
  };
  try {
    for (const [id,suffix] of [[org,"A"],[foreignOrg,"B"]]) {
      await admin.execute(
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,code+suffix,"Synthetic scheme governance"]);
    }
    for (const [id,suffix] of [[disabledFirst,"D"],[registeredFirst,"R"]]) {
      await admin.execute(
        "INSERT INTO patient_identifier_schemes(id,organization_id,code,name_en,"+
        "identifier_type,updated_at) VALUES(?,?,?,?,'OTHER',NOW(3))",
        [id,org,code+suffix,"Synthetic identifier scheme"]);
    }
    await staff.execute("SET SESSION innodb_lock_wait_timeout=1");

    // First direction: admin soft-disables scheme while staff has already
    // loaded a registration form. Staff cannot race past that deactivation.
    await admin.beginTransaction();
    assert.equal((await lock(admin,org)).length,1);
    await admin.execute(
      "UPDATE patient_identifier_schemes SET status='INACTIVE',deactivated_at=NOW(3)," +
      "updated_at=NOW(3) WHERE id=? AND organization_id=? AND status='ACTIVE'",
      [disabledFirst,org]);
    await staff.beginTransaction();
    assert.equal((await lock(staff,foreignOrg)).length,1,
      "independent organization has no cross-tenant lock contention");
    await staff.rollback();
    await staff.beginTransaction();
    await assert.rejects(()=>lock(staff,org),
      (error:unknown)=>Boolean(error && typeof error==="object" &&
        "code" in error && error.code==="ER_LOCK_WAIT_TIMEOUT"));
    await staff.rollback();
    await admin.commit();
    await staff.beginTransaction();
    assert.equal((await lock(staff,org)).length,1);
    assert.deepEqual(await activeScheme(staff,disabledFirst),[],
      "stale registration selection is rejected after acquiring tenant lock");
    await staff.rollback();

    // Reverse direction: staff registers a patient with a still-ACTIVE scheme
    // under the tenant lock. Admin cannot disable that scheme until the
    // committed patient and identifier are visible.
    await staff.beginTransaction();
    assert.equal((await lock(staff,org)).length,1);
    assert.equal((await activeScheme(staff,registeredFirst)).length,1);
    await staff.execute(
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at)"+
      " VALUES(?,?,?,?,?,NOW(3))",
      [patient,org,code+"PATIENT","Synthetic patient","SYNTHETIC PATIENT"]);
    await staff.execute(
      "INSERT INTO patient_identifiers(id,organization_id,patient_id,scheme_id,"+
      "identifier_type,value,normalized_value,is_primary,updated_at) "+
      "VALUES(?,?,?,?,'OTHER',?,?,1,NOW(3))",
      [identifier,org,patient,registeredFirst,code+"VALUE",code+"VALUE"]);
    await admin.beginTransaction();
    await admin.query("SET SESSION innodb_lock_wait_timeout=1");
    await assert.rejects(()=>lock(admin,org),
      (error:unknown)=>Boolean(error && typeof error==="object" &&
        "code" in error && error.code==="ER_LOCK_WAIT_TIMEOUT"));
    await admin.rollback();
    await staff.commit();

    await admin.beginTransaction();
    assert.equal((await lock(admin,org)).length,1);
    const [before]=await admin.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM patient_identifiers WHERE id=? AND scheme_id=? AND status='ACTIVE'",
      [identifier,registeredFirst]);
    assert.equal(before.length,1);
    await admin.execute(
      "UPDATE patient_identifier_schemes SET status='INACTIVE',deactivated_at=NOW(3)," +
      "updated_at=NOW(3) WHERE id=? AND organization_id=? AND status='ACTIVE'",
      [registeredFirst,org]);
    await admin.commit();
    const [history]=await staff.execute<mysql.RowDataPacket[]>(
      "SELECT i.id,i.scheme_id,s.status AS scheme_status FROM patient_identifiers i "+
      "JOIN patient_identifier_schemes s ON s.id=i.scheme_id WHERE i.id=?",
      [identifier]);
    assert.equal(history.length,1);
    assert.equal(history[0].scheme_id,registeredFirst);
    assert.equal(history[0].scheme_status,"INACTIVE",
      "scheme disabling preserves original identifier references");
    await assert.rejects(()=>staff.execute(
      "INSERT INTO patient_identifiers(id,organization_id,patient_id,scheme_id,"+
      "identifier_type,value,normalized_value,is_primary,updated_at) "+
      "VALUES(?,?,?,?,'OTHER',?,?,0,NOW(3))",
      [randomUUID(),org,patient,registeredFirst,code+"VALUE",code+"VALUE"]),
      (error:unknown)=>Boolean(error && typeof error==="object" &&
        "code" in error && error.code==="ER_DUP_ENTRY"));
  } finally {
    await admin.rollback().catch(()=>{});
    await staff.rollback().catch(()=>{});
    await admin.execute("DELETE FROM patient_identifiers WHERE id=?",[identifier]).catch(()=>{});
    await admin.execute("DELETE FROM patients WHERE id=?",[patient]).catch(()=>{});
    await admin.execute("DELETE FROM patient_identifier_schemes WHERE id IN (?,?)",
      [disabledFirst,registeredFirst]).catch(()=>{});
    await admin.execute("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    await Promise.all([admin.end(),staff.end()]);
  }
});
