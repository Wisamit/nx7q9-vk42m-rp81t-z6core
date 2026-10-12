import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { canFinalizeMfaChallenge } from "../src/lib/mfa-challenge-fencing.ts";

test("Stage 89 MariaDB: concurrent MFA challenge consumption is single-use, password epoch fences old challenges",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [db,competing]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),branch=randomUUID(),user=randomUUID(),challenge=randomUUID(),
    session=randomUUID(),suffix=org.slice(0,8);
  try{
    await db.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"S89"+suffix,"Stage89 Lab"]);
    await db.execute("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S89"+suffix,"Stage89 Branch"]);
    await db.execute("INSERT INTO users(id,organization_id,username,display_name_en,status,mfa_enabled,updated_at) "+
      "VALUES(?,?,?,?,'ACTIVE',1,NOW(3))",[user,org,"s89"+suffix,"Stage89 Staff"]);
    await db.execute("INSERT INTO staff_mfa_challenges(id,user_id,token_hash,expires_at) "+
      "VALUES(?,?,?,DATE_ADD(NOW(3),INTERVAL 5 MINUTE))",[challenge,user,"f".repeat(64)]);
    await db.beginTransaction();
    const [lockedUser]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM users WHERE id=? FOR UPDATE",[user]);
    const [lockedChallenge]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM staff_mfa_challenges WHERE id=? AND user_id=? FOR UPDATE",[challenge,user]);
    assert.equal(lockedUser.length,1);assert.equal(lockedChallenge.length,1);
    await competing.query("SET innodb_lock_wait_timeout=1");
    await competing.beginTransaction();
    let blocked=false;
    try {
      await competing.execute("UPDATE users SET password_changed_at=NOW(3) WHERE id=?",[user]);
    } catch {blocked=true;}
    await competing.rollback();
    assert.equal(blocked,true,"password reset blocked during MFA acceptance");
    const [claimed]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE staff_mfa_challenges SET consumed_at=NOW(3) "+
      "WHERE id=? AND user_id=? AND token_hash=? AND consumed_at IS NULL AND expires_at>NOW(3)",
      [challenge,user,"f".repeat(64)]);
    assert.equal(claimed.affectedRows,1);
    await db.execute("INSERT INTO user_sessions(id,user_id,active_branch_id,token_hash,expires_at) "+
      "VALUES(?,?,?,?,DATE_ADD(NOW(3),INTERVAL 1 DAY))",
      [session,user,branch,"a".repeat(64)]);
    await db.commit();
    const [replay]=await competing.execute<mysql.ResultSetHeader>(
      "UPDATE staff_mfa_challenges SET consumed_at=NOW(3) "+
      "WHERE id=? AND user_id=? AND token_hash=? AND consumed_at IS NULL AND expires_at>NOW(3)",
      [challenge,user,"f".repeat(64)]);
    assert.equal(replay.affectedRows,0,"a second request must never claim same OTP challenge");
    const [issued]=await competing.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM user_sessions WHERE user_id=?",[user]);
    assert.equal(issued.length,1);
    const [row]=await competing.execute<mysql.RowDataPacket[]>(
      "SELECT c.created_at,c.consumed_at,c.expires_at,u.password_changed_at "+
      "FROM staff_mfa_challenges c JOIN users u ON u.id=c.user_id WHERE c.id=?",[challenge]);
    assert.equal(canFinalizeMfaChallenge({
      consumedAt:new Date(row[0].consumed_at),
      expiresAt:new Date(row[0].expires_at),
      createdAt:new Date(row[0].created_at),
      passwordChangedAt:row[0].password_changed_at?new Date(row[0].password_changed_at):null,
      userStatus:"ACTIVE",organizationStatus:"ACTIVE",mfaEnabled:true,hasSecret:true,
    },new Date()),false);
    await db.execute("UPDATE users SET password_changed_at=DATE_ADD(NOW(3),INTERVAL 1 SECOND) WHERE id=?",[user]);
    const [epoch]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT c.created_at,u.password_changed_at FROM staff_mfa_challenges c "+
      "JOIN users u ON u.id=c.user_id WHERE c.id=?",[challenge]);
    assert.ok(new Date(epoch[0].password_changed_at).getTime()>new Date(epoch[0].created_at).getTime());
    const [revoked]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE user_sessions SET revoked_at=NOW(3) WHERE user_id=? AND revoked_at IS NULL",[user]);
    assert.equal(revoked.affectedRows,1);
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),competing.rollback().catch(()=>{})]);
    await db.execute("DELETE FROM user_sessions WHERE id=?",[session]).catch(()=>{});
    await db.execute("DELETE FROM staff_mfa_challenges WHERE id=?",[challenge]).catch(()=>{});
    await db.execute("DELETE FROM users WHERE id=?",[user]).catch(()=>{});
    await db.execute("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await db.execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([db.end(),competing.end()]);
  }
});
