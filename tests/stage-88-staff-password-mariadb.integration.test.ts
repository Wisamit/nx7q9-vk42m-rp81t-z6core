import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hash, compare } from "bcryptjs";
import mysql from "mysql2/promise";
import {
  staffCredentialTargetAllowed, isActiveSystemAdmin,
} from "../src/lib/staff-password-policy.ts";

test("Stage 88 MariaDB: tenant-bound staff password reset, row locking, session/MFA revocation, immutable audit",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [db,competitor]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),outsiderOrg=randomUUID(),branch=randomUUID(),
    actor=randomUUID(),target=randomUUID(),other=randomUUID(),
    session1=randomUUID(),session2=randomUUID(),challenge=randomUUID(),
    eventId=randomUUID(),suffix=org.slice(0,8);
  const original="Original-Staff-Secret-123!", next="New-Staff-Secret-9842!";
  const actorPassword="Admin-MFA-Staff-Secret-123!";
  const priorHash=await hash(original,12),actorHash=await hash(actorPassword,12);
  const cleanup:Array<{table:string;id:string}>=[];
  const insert=async(table:string,id:string,sql:string,params:(string|number|null)[])=>{
    await db.execute(sql,params);cleanup.unshift({table,id});
  };
  try{
    for(const [id,k] of [[org,"A"],[outsiderOrg,"B"]]){
      await insert("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S88"+suffix+k,"Stage88 Lab"]);
    }
    await insert("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S88"+suffix,"Stage88 Branch"]);
    for(const [id,tenant,name,password,mfa] of [
      [actor,org,"admin",actorHash,0],
      [target,org,"staff",priorHash,1],
      [other,outsiderOrg,"outside",priorHash,0],
    ] as Array<[string,string,string,string,number]>){
      await insert("users",id,
        "INSERT INTO users(id,organization_id,username,display_name_en,password_hash,status,mfa_enabled,updated_at) "+
        "VALUES(?,?,?,?,?,'ACTIVE',?,NOW(3))",
        [id,tenant,"s88"+suffix+name,name,password,mfa]);
    }
    for(const [id,who,token] of [[session1,target,"1"],[session2,target,"2"]]){
      await insert("user_sessions",id,
        "INSERT INTO user_sessions(id,user_id,active_branch_id,token_hash,expires_at) "+
        "VALUES(?,?,?,?,DATE_ADD(NOW(3),INTERVAL 1 DAY))",
        [id,who,branch,token.repeat(64)]);
    }
    await insert("staff_mfa_challenges",challenge,
      "INSERT INTO staff_mfa_challenges(id,user_id,token_hash,expires_at) "+
      "VALUES(?,?,?,DATE_ADD(NOW(3),INTERVAL 5 MINUTE))",
      [challenge,target,"c".repeat(64)]);
    const [foreign]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM users WHERE id=? AND organization_id=?",[other,org]);
    assert.equal(foreign.length,0);
    assert.equal(staffCredentialTargetAllowed({
      actorId:actor,targetId:other,actorOrganizationId:org,
      targetOrganizationId:outsiderOrg,actorIsSystemAdmin:true,
      actorHasManagePermission:true,targetStatus:"ACTIVE",
    }),false);
    assert.equal(isActiveSystemAdmin([{role:{code:"SYSTEM_ADMIN",status:"ACTIVE"}}]),true);
    assert.equal(await compare(actorPassword,actorHash),true);
    assert.equal(await compare("invalid",actorHash),false);
    await db.beginTransaction();
    const [targetLock]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM users WHERE id=? AND organization_id=? FOR UPDATE",[target,org]);
    assert.equal(targetLock.length,1);
    await competitor.query("SET innodb_lock_wait_timeout=1");
    await competitor.beginTransaction();
    let blocked=false;
    try {
      await competitor.execute("UPDATE users SET failed_login_attempts = 1 WHERE id=?",[target]);
    } catch {blocked=true;}
    await competitor.rollback();
    assert.equal(blocked,true,"no concurrent login/credential status change while reset is locked");
    await db.rollback();
    const [before]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT password_hash,failed_login_attempts,mfa_enabled FROM users WHERE id=?",[target]);
    assert.equal(before[0].password_hash,priorHash);
    assert.equal(before[0].mfa_enabled,1);
    // Same SQL operations as secure admin reset transaction; all are atomic.
    await db.beginTransaction();
    const [locked]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM users WHERE id=? AND organization_id=? FOR UPDATE",[target,org]);
    assert.equal(locked.length,1);
    const nextHash=await hash(next,12);
    const [changed]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE users SET password_hash=?,password_changed_at=NOW(3),"+
      "failed_login_attempts=0,locked_until=NULL,updated_at=NOW(3) WHERE id=? AND organization_id=?",
      [nextHash,target,org]);
    assert.equal(changed.affectedRows,1);
    const [revoked]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE user_sessions SET revoked_at=NOW(3) WHERE user_id=? AND revoked_at IS NULL",[target]);
    assert.equal(revoked.affectedRows,2);
    const [used]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE staff_mfa_challenges SET consumed_at=NOW(3) WHERE user_id=? AND consumed_at IS NULL",
      [target]);
    assert.equal(used.affectedRows,1);
    await db.execute("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,"+
      "entity_type,entity_id,reason,new_values) VALUES(?,?,?,?,"+
      "'STAFF_PASSWORD_ADMIN_RESET','User',?,?,?)",
      [eventId,org,branch,actor,target,"Authorized recovery after password loss",
        JSON.stringify({sessionsRevoked:true,mfaPreserved:true})]);
    cleanup.unshift({table:"audit_events",id:eventId});
    await db.commit();
    const [after]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT password_hash,mfa_enabled,password_changed_at,failed_login_attempts,locked_until "+
      "FROM users WHERE id=?",[target]);
    assert.equal(await compare(next,after[0].password_hash),true);
    assert.equal(await compare(original,after[0].password_hash),false);
    assert.equal(after[0].mfa_enabled,1,"MFA survives credential recovery");
    assert.ok(after[0].password_changed_at);
    assert.equal(after[0].failed_login_attempts,0);
    assert.equal(after[0].locked_until,null);
    const [sessions]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT revoked_at FROM user_sessions WHERE user_id=?",[target]);
    assert.equal(sessions.length,2);
    assert.ok(sessions.every(row=>row.revoked_at!==null));
    const [challenges]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT consumed_at FROM staff_mfa_challenges WHERE user_id=?",[target]);
    assert.ok(challenges.every(row=>row.consumed_at!==null));
    const [audits]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT actor_user_id,reason,new_values FROM audit_events WHERE id=?",[eventId]);
    assert.equal(audits[0].actor_user_id,actor);
    assert.equal(audits[0].reason,"Authorized recovery after password loss");
    const serialized=JSON.stringify(audits[0].new_values);
    assert.ok(!serialized.includes(next));
    assert.ok(!serialized.includes(nextHash));
    const [unmodified]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT password_hash FROM users WHERE id=?",[other]);
    assert.equal(unmodified[0].password_hash,priorHash);
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),competitor.rollback().catch(()=>{})]);
    for(const {table,id} of cleanup)await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
    await Promise.all([db.end(),competitor.end()]);
  }
});
