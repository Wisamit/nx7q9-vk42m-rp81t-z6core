import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {clinicalRuleProofResource} from "../src/lib/clinical-rule-step-up.ts";

test("Stage 120 MariaDB: typed clinical proofs are one-time and competing reflex reviewers have one winner",
  {timeout:90000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL),cfg={
    host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)};
  const [db,rival]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),otherOrg=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),
    user=randomUUID(),session=randomUUID(),patient=randomUUID(),order=randomUUID(),
    sourceTest=randomUUID(),targetTest=randomUUID(),item=randomUUID(),result=randomUUID(),
    rule=randomUUID(),event=randomUUID(),suffix=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[],auditIds:string[]=[];
  const put=async(table:string,id:string,sql:string,args:(string|number|null)[])=>{
    await db.execute(sql,args);cleanup.unshift({table,id});
  };
  try {
    for(const [id,s] of [[org,"A"],[otherOrg,"B"]])await put("organizations",id,
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,"S120"+suffix+s,"Stage120 tenant"]);
    for(const [id,s] of [[branch,"A"],[otherBranch,"B"]])await put("branches",id,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id,org,"S120"+suffix+s,"Stage120 branch"]);
    await put("users",user,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [user,org,"stage120"+suffix,"Clinical approver"]);
    await put("user_branch_scopes",user,
      "INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[user,branch]);
    await put("user_sessions",session,
      "INSERT INTO user_sessions(id,user_id,active_branch_id,token_hash,expires_at) VALUES(?,?,?,?,DATE_ADD(NOW(3),INTERVAL 1 HOUR))",
      [session,user,branch,createHash("sha256").update(session).digest("hex")]);
    const resource=clinicalRuleProofResource("REFLEX_RULE",rule);
    assert.ok(resource);
    for(const action of ["CLINICAL_RULE_APPROVE","CLINICAL_RULE_RETIRE"]){
      const token=randomBytes(32).toString("base64url");
      const digest=createHash("sha256").update(token).digest("hex");
      const id=randomUUID();
      await put("staff_step_up_grants",id,
        "INSERT INTO staff_step_up_grants(id,user_id,session_id,organization_id,branch_id,action,resource_key,token_hash,proof_method,expires_at) VALUES(?,?,?,?,?,?,?,?,?,DATE_ADD(NOW(3),INTERVAL 2 MINUTE))",
        [id,user,session,org,branch,action,resource,digest,"PASSWORD_TOTP"]);
      const q="SELECT id FROM staff_step_up_grants WHERE token_hash=? AND session_id=? AND user_id=? AND organization_id=? AND branch_id=? AND action=? AND resource_key=? AND consumed_at IS NULL";
      const original=[digest,session,user,org,branch,action,resource];
      const [yes]=await db.execute<mysql.RowDataPacket[]>(q,original);
      assert.equal(yes.length,1);
      for(const args of [
        [digest,session,user,otherOrg,branch,action,resource],
        [digest,session,user,org,otherBranch,action,resource],
        [digest,session,user,org,branch,action==="CLINICAL_RULE_APPROVE"?"CLINICAL_RULE_RETIRE":"CLINICAL_RULE_APPROVE",resource],
        [digest,session,user,org,branch,action,clinicalRuleProofResource("DELTA_RULE",rule)!],
        [digest,session,user,org,branch,action,clinicalRuleProofResource("REFLEX_RULE",randomUUID())!],
      ]){
        const [no]=await db.execute<mysql.RowDataPacket[]>(q,args);
        assert.equal(no.length,0,"proof may not be borrowed for another scope/action/type");
      }
      await db.beginTransaction();
      const [claimed]=await db.execute<mysql.ResultSetHeader>(
        "UPDATE staff_step_up_grants SET consumed_at=NOW(3) WHERE id=? AND action=? AND resource_key=? AND token_hash=? AND consumed_at IS NULL AND expires_at>NOW(3)",
        [id,action,resource,digest]);
      assert.equal(claimed.affectedRows,1);
      await db.commit();
      const [replay]=await rival.execute<mysql.ResultSetHeader>(
        "UPDATE staff_step_up_grants SET consumed_at=NOW(3) WHERE id=? AND consumed_at IS NULL",[id]);
      assert.equal(replay.affectedRows,0);
    }
    for(const [id,s] of [[sourceTest,"SOURCE"],[targetTest,"TARGET"]])await put("lab_tests",id,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id,org,"S120"+suffix+s,"Clinical test"]);
    await put("patients",patient,
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [patient,org,"S120"+suffix,"Synthetic patient","synthetic patient"]);
    await put("orders",order,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [order,org,"S120"+suffix,branch,patient,user]);
    await put("order_items",item,
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
      [item,order,sourceTest,"SRC","Source test"]);
    await put("laboratory_results",result,
      "INSERT INTO laboratory_results(id,organization_id,order_item_id,performing_branch_id,entered_by_user_id,status,updated_at) VALUES(?,?,?,?,?,'ENTERED',NOW(3))",
      [result,org,item,branch,user]);
    await put("reflex_rules",rule,
      "INSERT INTO reflex_rules(id,organization_id,source_test_id,target_test_id,operator,text_threshold,effective_from,updated_at) VALUES(?,?,?,?,?,'positive',NOW(3),NOW(3))",
      [rule,org,sourceTest,targetTest,"EQ"]);
    await put("reflex_rule_events",event,
      "INSERT INTO reflex_rule_events(id,result_id,rule_id,status,trigger_value_snapshot,target_test_code_snapshot,target_test_name_en_snapshot,updated_at) VALUES(?,?,?,'PENDING','positive','TARGET','Target',NOW(3))",
      [event,result,rule]);
    await db.query("SET SESSION innodb_lock_wait_timeout=2");
    await rival.query("SET SESSION innodb_lock_wait_timeout=2");
    async function review(conn:mysql.Connection,status:"ACKNOWLEDGED"|"DISMISSED"){
      await conn.beginTransaction();
      try{
        const [claim]=await conn.execute<mysql.ResultSetHeader>(
          "UPDATE reflex_rule_events SET status=?,reviewed_by_user_id=?,reviewed_at=NOW(3) WHERE id=? AND result_id=? AND status='PENDING'",
          [status,user,event,result]);
        if(claim.affectedRows!==1){await conn.rollback();return false;}
        const audit=randomUUID();
        await conn.execute(
          "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id) VALUES(?,?,?,?,'REFLEX_RECOMMENDATION_REVIEWED','ReflexRuleEvent',?)",
          [audit,org,branch,user,event]);
        await conn.commit();auditIds.push(audit);return true;
      }catch(error){await conn.rollback();throw error;}
    }
    const winners=await Promise.all([review(db,"ACKNOWLEDGED"),review(rival,"DISMISSED")]);
    assert.equal(winners.filter(Boolean).length,1,"only one decision may be committed");
    const [state]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT status,reviewed_by_user_id FROM reflex_rule_events WHERE id=?",[event]);
    assert.ok(["ACKNOWLEDGED","DISMISSED"].includes(state[0].status));
    assert.equal(state[0].reviewed_by_user_id,user);
    const [audits]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM audit_events WHERE entity_type='ReflexRuleEvent' AND entity_id=?",[event]);
    assert.equal(Number(audits[0].total),1,"loser must not add clinical audit evidence");
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
    for(const id of auditIds)await db.execute("DELETE FROM audit_events WHERE id=?",[id]).catch(()=>{});
    for(const {table,id} of cleanup)await db.execute(
      "DELETE FROM "+table+" WHERE "+(table==="user_branch_scopes"?"user_id":"id")+"=?",[id]).catch(()=>{});
    await Promise.all([db.end(),rival.end()]);
  }
});
