import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import mysql from "mysql2/promise";

const sha=(value:string)=>createHash("sha256").update(value).digest("hex");

test("Stage 110 MariaDB: identity, amendment and credit approval proofs are tenant/session/branch/resource bound and single-use",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={
    host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1),
  };
  const [db,concurrent]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const organizationId=randomUUID(),otherOrganizationId=randomUUID();
  const branchId=randomUUID(),otherBranchId=randomUUID();
  const userId=randomUUID(),sessionId=randomUUID(),otherSessionId=randomUUID();
  const sourceId=randomUUID(),targetId=randomUUID(),resultId=randomUUID(),invoiceId=randomUUID();
  const uniqueSuffix=organizationId.slice(0,8);
  const cleanup:Array<{table:string;where:string;key:string}>=[];
  async function insert(table:string,key:string,sql:string,values:(string|number)[],where="id"){
    await db.execute(sql,values);
    cleanup.unshift({table,where,key});
  }
  const actions=[
    {action:"PATIENT_MERGE",resource:sourceId+":"+targetId,other:targetId+":"+sourceId},
    {action:"RESULT_AMEND",resource:resultId,other:randomUUID()},
    {action:"CREDIT_NOTE_ISSUE",resource:invoiceId+":12.2500",other:invoiceId+":12.2501"},
  ];
  try{
    for(const [id,letter] of [[organizationId,"A"],[otherOrganizationId,"B"]]){
      await insert("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S110"+uniqueSuffix+letter,"StepUp Lab"]);
    }
    for(const [id,organization,letter] of [
      [branchId,organizationId,"A"],[otherBranchId,otherOrganizationId,"B"],
    ]){
      await insert("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,organization,"S110"+uniqueSuffix+letter,"StepUp Branch"]);
    }
    await insert("users",userId,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [userId,organizationId,"s110"+uniqueSuffix,"StepUp Operator"]);
    await insert("user_branch_scopes",userId,
      "INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",
      [userId,branchId],"user_id");
    for(const [id,branch] of [[sessionId,branchId],[otherSessionId,branchId]]){
      await insert("user_sessions",id,
        "INSERT INTO user_sessions(id,user_id,active_branch_id,token_hash,expires_at) VALUES(?,?,?,?,DATE_ADD(NOW(3),INTERVAL 1 HOUR))",
        [id,userId,branch,sha("session:"+id)]);
    }
    await concurrent.query("SET SESSION innodb_lock_wait_timeout=1");
    for(const action of actions){
      const grantId=randomUUID(),token=randomBytes(32).toString("base64url"),digest=sha(token);
      await insert("staff_step_up_grants",grantId,
        "INSERT INTO staff_step_up_grants(id,user_id,session_id,organization_id,branch_id,action,resource_key,token_hash,proof_method,expires_at) VALUES(?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(3),INTERVAL 2 MINUTE))",
        [grantId,userId,sessionId,organizationId,branchId,action.action,action.resource,digest,"PASSWORD_TOTP"]);
      const query="SELECT id FROM staff_step_up_grants WHERE token_hash=? AND user_id=? AND session_id=? "+
        "AND organization_id=? AND branch_id=? AND action=? AND resource_key=? "+
        "AND consumed_at IS NULL AND expires_at>NOW(3)";
      const valid=[digest,userId,sessionId,organizationId,branchId,action.action,action.resource];
      const wrong=[
        [digest,userId,otherSessionId,organizationId,branchId,action.action,action.resource],
        [digest,userId,sessionId,otherOrganizationId,branchId,action.action,action.resource],
        [digest,userId,sessionId,organizationId,otherBranchId,action.action,action.resource],
        [digest,userId,sessionId,organizationId,branchId,action.action,action.other],
        [digest,userId,sessionId,organizationId,branchId,"RESULT_RELEASE",action.resource],
        [sha("imposter"),userId,sessionId,organizationId,branchId,action.action,action.resource],
      ];
      for(const attempted of wrong){
        const [rows]=await db.execute<mysql.RowDataPacket[]>(query,attempted);
        assert.equal(rows.length,0,action.action+" grant cannot be borrowed");
      }
      const [authorized]=await db.execute<mysql.RowDataPacket[]>(query,valid);
      assert.equal(authorized.length,1);
      await db.beginTransaction();
      const [locked]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT id,consumed_at FROM staff_step_up_grants WHERE id=? FOR UPDATE",[grantId]);
      assert.equal(locked.length,1);
      assert.equal(locked[0].consumed_at,null);
      await concurrent.beginTransaction();
      await assert.rejects(
        concurrent.execute("UPDATE staff_step_up_grants SET consumed_at=NOW(3) WHERE id=? AND consumed_at IS NULL",[grantId]),
        (err:unknown)=>Boolean(err&&typeof err==="object"&&"code" in err&&err.code==="ER_LOCK_WAIT_TIMEOUT"));
      await concurrent.rollback();
      const [claimed]=await db.execute<mysql.ResultSetHeader>(
        "UPDATE staff_step_up_grants SET consumed_at=NOW(3) WHERE id=? AND token_hash=? AND action=? AND resource_key=? AND consumed_at IS NULL AND expires_at>NOW(3)",
        [grantId,digest,action.action,action.resource]);
      assert.equal(claimed.affectedRows,1,action.action+" once");
      await db.commit();
      const [replay]=await concurrent.execute<mysql.ResultSetHeader>(
        "UPDATE staff_step_up_grants SET consumed_at=NOW(3) WHERE id=? AND token_hash=? AND consumed_at IS NULL",[grantId,digest]);
      assert.equal(replay.affectedRows,0,action.action+" cannot be consumed again");
      const [consumed]=await concurrent.execute<mysql.RowDataPacket[]>(query,valid);
      assert.equal(consumed.length,0);
      const [proof]=await concurrent.execute<mysql.RowDataPacket[]>(
        "SELECT proof_method,action,resource_key FROM staff_step_up_grants WHERE id=?",[grantId]);
      assert.equal(proof[0].proof_method,"PASSWORD_TOTP");
      assert.equal(proof[0].action,action.action);
      assert.equal(proof[0].resource_key,action.resource);
    }
  } finally {
    await Promise.all([db.rollback().catch(()=>{}),concurrent.rollback().catch(()=>{})]);
    for(const row of cleanup){
      await db.execute("DELETE FROM "+row.table+" WHERE "+row.where+"=?",[row.key]).catch(()=>{});
    }
    await Promise.all([db.end(),concurrent.end()]);
  }
});
