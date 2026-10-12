import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 90 MariaDB: explicit doctor grants, tenant isolation, atomic revocation and access expiry",{
 timeout:75000,
},async()=>{
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
 const url=new URL(process.env.DATABASE_URL);
 const cfg={host:url.hostname,port:Number(url.port||3306),
  user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
  database:url.pathname.slice(1)};
 const [db,competitor]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
 const org=randomUUID(),otherOrg=randomUUID(),branch=randomUUID(),actor=randomUUID(),
  referrer=randomUUID(),patient=randomUUID(),foreignPatient=randomUUID(),
  access=randomUUID(),access2=randomUUID(),eventId=randomUUID(),
  revokeEventId=randomUUID(),suffix=org.slice(0,8);
 const garbage:Array<{table:string;id:string}>=[];
 async function add(table:string,id:string,sql:string,args:(string|number|null)[]) {
  await db.execute(sql,args);garbage.unshift({table,id});
 }
 try {
  for(const [id,k] of [[org,"A"],[otherOrg,"B"]])await add("organizations",id,
   "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
   [id,"S90"+suffix+k,"Stage90 Organization"]);
  await add("branches",branch,
   "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
   [branch,org,"S90"+suffix,"Stage90 Branch"]);
  await add("users",actor,
   "INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) "+
   "VALUES(?,?,?,?, 'ACTIVE',NOW(3))",[actor,org,"s90"+suffix,"Stage90 Admin"]);
  await add("referrers",referrer,
   "INSERT INTO referrers(id,organization_id,code,name_en,type,status,updated_at) "+
   "VALUES(?,?,?,?,'PHYSICIAN','ACTIVE',NOW(3))",
   [referrer,org,"S90REF","Stage90 Doctor"]);
  for(const [id,tenant,name] of [[patient,org,"Local"],[foreignPatient,otherOrg,"Foreign"]]){
   await add("patients",id,
    "INSERT INTO patients(id,organization_id,patient_number,full_name_en,status,updated_at) "+
    "VALUES(?,?,?,?,'ACTIVE',NOW(3))",[id,tenant,"S90"+id.slice(0,8),name]);
  }
  const [foreign]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM patients WHERE id=? AND organization_id=? AND status='ACTIVE' FOR UPDATE",
   [foreignPatient,org]);
  assert.equal(foreign.length,0);
  const [local]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM patients WHERE id=? AND organization_id=? AND status='ACTIVE'",
   [patient,org]);
  assert.equal(local.length,1);
  await add("doctor_portal_patient_access",access,
   "INSERT INTO doctor_portal_patient_access(id,organization_id,referrer_id,patient_id,"+
   "can_view_orders,can_view_reports,effective_from,status,reason,created_by_user_id,updated_at) "+
   "VALUES(?,?,?,?,1,0,DATE_SUB(NOW(3),INTERVAL 1 DAY),'ACTIVE',?,?,NOW(3))",
   [access,org,referrer,patient,"Documented doctor authorization",actor]);
  const check="SELECT id,can_view_orders,can_view_reports FROM doctor_portal_patient_access "+
   "WHERE organization_id=? AND referrer_id=? AND patient_id=? AND status='ACTIVE' "+
   "AND effective_from<=NOW(3) AND (effective_to IS NULL OR effective_to>=NOW(3))";
  const [before]=await db.execute<mysql.RowDataPacket[]>(check,[org,referrer,patient]);
  assert.equal(before.length,1);assert.equal(before[0].can_view_orders,1);
  assert.equal(before[0].can_view_reports,0,"order permission must not reveal reports");
  await add("doctor_portal_patient_access",access2,
   "INSERT INTO doctor_portal_patient_access(id,organization_id,referrer_id,patient_id,"+
   "can_view_orders,can_view_reports,effective_from,effective_to,status,reason,created_by_user_id,updated_at) "+
   "VALUES(?,?,?,?,0,1,DATE_SUB(NOW(3),INTERVAL 3 DAY),DATE_SUB(NOW(3),INTERVAL 1 DAY),'INACTIVE',?,?,NOW(3))",
   [access2,org,referrer,patient,"Expired old authorization",actor]);
  const [expired]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM doctor_portal_patient_access WHERE id=? AND status='ACTIVE' "+
   "AND effective_from<=NOW(3) AND (effective_to IS NULL OR effective_to>=NOW(3))",[access2]);
  assert.equal(expired.length,0);
  await db.beginTransaction();
  const [lock]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM doctor_portal_patient_access WHERE id=? AND organization_id=? FOR UPDATE",
   [access,org]);assert.equal(lock.length,1);
  await competitor.query("SET innodb_lock_wait_timeout=1");
  await competitor.beginTransaction();
  let blocked=false;
  try{await competitor.execute(
   "UPDATE doctor_portal_patient_access SET status='INACTIVE' WHERE id=?",[access]);
  }catch{blocked=true;}
  await competitor.rollback();
  assert.equal(blocked,true,"grant cannot be concurrently mutated while reviewed");
  await db.execute("UPDATE doctor_portal_patient_access "+
   "SET status='INACTIVE',revoked_at=NOW(3),revoked_by_user_id=?,"+
   "revoke_reason=?,updated_at=NOW(3) WHERE id=? AND organization_id=? AND status='ACTIVE'",
   [actor,"Patient requested withdrawal",access,org]);
  await db.execute(
   "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,"+
   "entity_type,entity_id,reason) VALUES(?,?,?,?,"+
   "'DOCTOR_PATIENT_PORTAL_ACCESS_REVOKED','DoctorPortalPatientAccess',?,?)",
   [revokeEventId,org,branch,actor,access,"Patient requested withdrawal"]);
  garbage.unshift({table:"audit_events",id:revokeEventId});
  await db.commit();
  const [after]=await competitor.execute<mysql.RowDataPacket[]>(check,[org,referrer,patient]);
  assert.equal(after.length,0,"revoked patient clinical access must disappear immediately");
  const [preserved]=await competitor.execute<mysql.RowDataPacket[]>(
   "SELECT reason,revoke_reason,revoked_by_user_id,status FROM doctor_portal_patient_access WHERE id=?",[access]);
  assert.equal(preserved[0].reason,"Documented doctor authorization");
  assert.equal(preserved[0].revoke_reason,"Patient requested withdrawal");
  assert.equal(preserved[0].revoked_by_user_id,actor);
  const [audit]=await competitor.execute<mysql.RowDataPacket[]>(
   "SELECT action,actor_user_id FROM audit_events WHERE id=?",[revokeEventId]);
  assert.equal(audit[0].action,"DOCTOR_PATIENT_PORTAL_ACCESS_REVOKED");
  assert.equal(audit[0].actor_user_id,actor);
 }finally{
  await Promise.all([db.rollback().catch(()=>{}),competitor.rollback().catch(()=>{})]);
  for(const {table,id} of garbage)await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
  await Promise.all([db.end(),competitor.end()]);
 }
});
