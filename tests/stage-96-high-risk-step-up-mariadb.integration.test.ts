import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 96 MariaDB: session-bound proof, atomic consumption, cross-tenant and replay resistance",{
 timeout:75000,
},async()=>{
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
 const u=new URL(process.env.DATABASE_URL);
 const cfg={host:u.hostname,port:Number(u.port||3306),
  user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
  database:u.pathname.slice(1)};
 const [db,rival]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
 const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),
  user=randomUUID(),session=randomUUID(),otherSession=randomUUID(),target=randomUUID(),
  grant=randomUUID(),audit=randomUUID(),suffix=org.slice(0,8),token="S96"+randomUUID(),
  digest=createHash("sha256").update(token).digest("hex");
 const cleanup:Array<{table:string;id:string}>=[];
 async function put(table:string,id:string,sql:string,args:(string|number|null)[]){
  await db.execute(sql,args);cleanup.unshift({table,id});
 }
 try{
  for(const [id,label]of [[org,"A"],[foreignOrg,"B"]]){
   await put("organizations",id,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
     [id,"S96"+suffix+label,"Stage96 Lab"]);
  }
  for(const [id,label] of [[branch,"A"],[otherBranch,"B"]]){
   await put("branches",id,
     "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
     [id,org,"S96"+suffix+label,"Stage96 Branch"]);
  }
  await put("users",user,
   "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
   [user,org,"s96"+suffix,"Step-up reviewer"]);
  await put("user_branch_scopes",user,
   "INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[user,branch]);
  for(const [id,selected,tag] of [[session,branch,"A"],[otherSession,otherBranch,"B"]]){
   await put("user_sessions",id,
     "INSERT INTO user_sessions(id,user_id,active_branch_id,token_hash,expires_at) "+
     "VALUES(?,?,?,?,DATE_ADD(NOW(3),INTERVAL 1 HOUR))",
     [id,user,selected,createHash("sha256").update(id+tag).digest("hex")]);
  }
  await put("staff_step_up_grants",grant,
   "INSERT INTO staff_step_up_grants(id,user_id,session_id,organization_id,branch_id,action,resource_key,token_hash,proof_method,expires_at) "+
   "VALUES(?,?,?,?,?,'RESULT_RELEASE',?,?,'PASSWORD_TOTP',DATE_ADD(NOW(3),INTERVAL 2 MINUTE))",
   [grant,user,session,org,branch,target,digest]);
  const checked="SELECT id FROM staff_step_up_grants WHERE token_hash=? AND session_id=? "+
   "AND user_id=? AND organization_id=? AND branch_id=? AND action=? "+
   "AND resource_key=? AND consumed_at IS NULL AND expires_at>NOW(3)";
  const own=[digest,session,user,org,branch,"RESULT_RELEASE",target];
  for(const wrong of [
   [digest,otherSession,user,org,branch,"RESULT_RELEASE",target],
   [digest,session,user,foreignOrg,branch,"RESULT_RELEASE",target],
   [digest,session,user,org,otherBranch,"RESULT_RELEASE",target],
   [digest,session,user,org,branch,"MEDICAL_APPROVAL",target],
   [digest,session,user,org,branch,"RESULT_RELEASE",randomUUID()],
  ]){
   const [rows]=await db.execute<mysql.RowDataPacket[]>(checked,wrong);
   assert.equal(rows.length,0,"scoped proof must not transfer between sessions/branches/actions");
  }
  const [authorized]=await db.execute<mysql.RowDataPacket[]>(checked,own);
  assert.equal(authorized.length,1);
  await db.beginTransaction();
  const [locked]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM staff_step_up_grants WHERE id=? FOR UPDATE",[grant]);
  assert.equal(locked.length,1);
  await rival.query("SET innodb_lock_wait_timeout=1");
  await rival.beginTransaction();
  let blocked=false;
  try{await rival.execute("UPDATE staff_step_up_grants SET consumed_at=NOW(3) WHERE id=?",[grant]);}
  catch{blocked=true;}
  await rival.rollback();
  assert.equal(blocked,true,"two concurrent approvals cannot claim the same grant without serialization");
  const [first]=await db.execute<mysql.ResultSetHeader>(
   "UPDATE staff_step_up_grants SET consumed_at=NOW(3) WHERE id=? "+
   "AND consumed_at IS NULL AND expires_at>NOW(3)",[grant]);
  assert.equal(first.affectedRows,1);
  await put("audit_events",audit,
   "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id) "+
   "VALUES(?,?,?,?,'STAFF_STEP_UP_CONSUMED','StaffStepUpGrant',?)",
   [audit,org,branch,user,grant]);
  await db.commit();
  const [again]=await rival.execute<mysql.ResultSetHeader>(
   "UPDATE staff_step_up_grants SET consumed_at=NOW(3) WHERE id=? "+
   "AND consumed_at IS NULL AND expires_at>NOW(3)",[grant]);
  assert.equal(again.affectedRows,0,"replay must never consume the same proof twice");
  const [nowUsed]=await rival.execute<mysql.RowDataPacket[]>(checked,own);
  assert.equal(nowUsed.length,0);
  const attempts=Array.from({length:5},()=>randomUUID());
  for(const id of attempts){
   await put("staff_step_up_attempts",id,
    "INSERT INTO staff_step_up_attempts(id,user_id,session_id,success) VALUES(?,?,?,0)",
    [id,user,session]);
  }
  const [count]=await rival.execute<mysql.RowDataPacket[]>(
   "SELECT COUNT(*) AS failed FROM staff_step_up_attempts WHERE user_id=? "+
   "AND success=FALSE AND created_at>=DATE_SUB(NOW(3),INTERVAL 15 MINUTE)",[user]);
  assert.equal(Number(count[0].failed),5,"failed attempts persist across worker processes");
  const [evidence]=await rival.execute<mysql.RowDataPacket[]>(
   "SELECT actor_user_id,branch_id FROM audit_events WHERE id=? AND action='STAFF_STEP_UP_CONSUMED'",
   [audit]);
  assert.equal(evidence[0].actor_user_id,user);
  assert.equal(evidence[0].branch_id,branch);
 }finally{
  await Promise.all([db.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
  for(const {table,id} of cleanup){
   await db.execute("DELETE FROM "+table+" WHERE "+(table==="user_branch_scopes"?"user_id":"id")+"=?",[id]).catch(()=>{});
  }
  await Promise.all([db.end(),rival.end()]);
 }
});
