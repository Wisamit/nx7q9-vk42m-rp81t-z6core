import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {eqaIndependentReviewer,eqaAllReviewed,eqaNextState} from "../src/lib/eqa-workflow.ts";

test("Stage 90 MariaDB: EQA branch isolation, analyte snapshots, atomic submitted/reviewed/closed history and concurrent lock",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [db,competitor]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),externalOrg=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),
    author=randomUUID(),submitter=randomUUID(),reviewer=randomUUID(),
    testId=randomUUID(),componentId=randomUUID(),programId=randomUUID(),roundId=randomUUID(),
    observationId=randomUUID(),eventIds:string[]=[];
  const suffix=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  async function insert(table:string,id:string,sql:string,args:(string|number|null)[]){
    await db.execute(sql,args);cleanup.unshift({table,id});
  }
  try {
    for(const [id,k] of [[org,"A"],[externalOrg,"X"]]){
      await insert("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"EQA"+suffix+k,"EQA Lab"]);
    }
    for(const [id,tenant,k] of [[branch,org,"A"],[otherBranch,externalOrg,"X"]]){
      await insert("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,"EQA"+suffix+k,"EQA Branch"]);
    }
    for(const [id,k] of [[author,"A"],[submitter,"S"],[reviewer,"R"]]){
      await insert("users",id,
        "INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
        [id,org,"eqa"+suffix+k,"EQA staff"]);
      await db.execute("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[id,branch]);
      cleanup.unshift({table:"user_branch_scopes",id:id+"|"+branch});
    }
    await insert("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,"EQA_TEST","Proficiency Test"]);
    await insert("test_components",componentId,
      "INSERT INTO test_components(id,test_id,code,name_en,name_ar,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [componentId,testId,"EQA_VALUE","Original En","النص الأصلي"]);
    await insert("eqa_programs",programId,
      "INSERT INTO eqa_programs(id,organization_id,branch_id,code,provider_name,name_en,name_ar,created_by_user_id,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,?,NOW(3))",
      [programId,org,branch,"CHEM_EQA","Independent Provider","Chemistry proficiency","كفاءة الكيمياء",author]);
    const [wrongTenant]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM eqa_programs WHERE id=? AND organization_id=?",[programId,externalOrg]);
    assert.equal(wrongTenant.length,0);
    const [wrongBranch]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM eqa_programs WHERE id=? AND branch_id=?",[programId,otherBranch]);
    assert.equal(wrongBranch.length,0);
    await insert("eqa_rounds",roundId,
      "INSERT INTO eqa_rounds(id,program_id,round_code,sample_code,status,created_by_user_id,updated_at) "+
      "VALUES(?,?,?,?,'OPEN',?,NOW(3))",[roundId,programId,"ROUND1","PROVIDER-SAMPLE-01",author]);
    await insert("eqa_observations",observationId,
      "INSERT INTO eqa_observations(id,round_id,entry_code,component_id,component_code_snapshot,"+
      "component_name_en_snapshot,component_name_ar_snapshot,observed_value,created_by_user_id) "+
      "VALUES(?,?,?,?,?,?,?,?,?)",
      [observationId,roundId,"ANALYTE1",componentId,"EQA_VALUE","Original En","النص الأصلي",
        "7.42",author]);
    // The stored clinical label remains a snapshot when the live catalog changes.
    await db.execute("UPDATE test_components SET name_en='Later catalog name', name_ar='اسم لاحق' WHERE id=?",[componentId]);
    const [snapshot]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT component_name_en_snapshot,component_name_ar_snapshot,observed_value,assessment "+
      "FROM eqa_observations WHERE id=?",[observationId]);
    assert.equal(snapshot[0].component_name_en_snapshot,"Original En");
    assert.equal(snapshot[0].component_name_ar_snapshot,"النص الأصلي");
    assert.equal(snapshot[0].assessment,null);
    // A second connection cannot submit or assess while the first owns the EQA round.
    await db.beginTransaction();
    const [locked]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM eqa_rounds WHERE id=? AND program_id=? FOR UPDATE",[roundId,programId]);
    assert.equal(locked.length,1);
    await competitor.query("SET innodb_lock_wait_timeout=1");
    await competitor.beginTransaction();
    let concurrentlyBlocked=false;
    try { await competitor.execute(
      "UPDATE eqa_rounds SET status='SUBMITTED' WHERE id=? AND status='OPEN'",[roundId]);
    } catch {concurrentlyBlocked=true;}
    await competitor.rollback();
    assert.equal(concurrentlyBlocked,true);
    assert.equal(eqaNextState("OPEN","SUBMIT_ROUND"),"SUBMITTED");
    const [submitted]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE eqa_rounds SET status='SUBMITTED',submitted_by_user_id=?,submitted_at=NOW(3),"+
      "updated_at=NOW(3) WHERE id=? AND status='OPEN'",[submitter,roundId]);
    assert.equal(submitted.affectedRows,1);
    const submitAudit=randomUUID();eventIds.push(submitAudit);
    await db.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,reason,new_values) "+
      "VALUES(?,?,?,?,'EQA_ROUND_SUBMITTED','EqaRound',?,?,?)",
      [submitAudit,org,branch,submitter,roundId,"Submission accepted after lab review",
        JSON.stringify({entries:[{id:observationId,value:"7.42"}]})]);
    await db.commit();
    // Submitted values are now read-only by workflow; distinct reviewer required.
    assert.equal(eqaIndependentReviewer(submitter,submitter,author),false);
    assert.equal(eqaIndependentReviewer(author,submitter,author),false);
    assert.equal(eqaIndependentReviewer(reviewer,submitter,author),true);
    const [submittedRow]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT status,submitted_by_user_id FROM eqa_rounds WHERE id=?",[roundId]);
    assert.equal(submittedRow[0].status,"SUBMITTED");
    assert.equal(submittedRow[0].submitted_by_user_id,submitter);
    await db.beginTransaction();
    const [claimed]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE eqa_observations SET assessment='UNSATISFACTORY',provider_expected_value='8.00',"+
      "provider_feedback='Provider method requires investigation',assessed_by_user_id=?,"+
      "assessed_at=NOW(3) WHERE id=? AND assessment IS NULL",[reviewer,observationId]);
    assert.equal(claimed.affectedRows,1);
    const [repeat]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE eqa_observations SET assessment='SATISFACTORY' WHERE id=? AND assessment IS NULL",
      [observationId]);
    assert.equal(repeat.affectedRows,0,"provider assessment cannot be overwritten");
    const [evaluation]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT assessment FROM eqa_observations WHERE round_id=?",[roundId]);
    assert.equal(eqaAllReviewed(evaluation),true);
    await db.execute("UPDATE eqa_rounds SET status='ASSESSED',reviewed_by_user_id=?,"+
      "reviewed_at=NOW(3),review_reason='Independent provider failure review',updated_at=NOW(3) "+
      "WHERE id=? AND status='SUBMITTED'",[reviewer,roundId]);
    const reviewAudit=randomUUID();eventIds.push(reviewAudit);
    await db.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,reason) "+
      "VALUES(?,?,?,?,'EQA_ROUND_INDEPENDENTLY_REVIEWED','EqaRound',?,?)",
      [reviewAudit,org,branch,reviewer,roundId,"Provider result evaluated independently"]);
    await db.commit();
    const [closed]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE eqa_rounds SET status='CLOSED',closed_by_user_id=?,closed_at=NOW(3),updated_at=NOW(3) "+
      "WHERE id=? AND status='ASSESSED'",[reviewer,roundId]);
    assert.equal(closed.affectedRows,1);
    const [final]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT r.status,r.submitted_by_user_id,r.reviewed_by_user_id,o.observed_value,"+
      "o.assessment,o.provider_expected_value,o.component_name_en_snapshot "+
      "FROM eqa_rounds r JOIN eqa_observations o ON o.round_id=r.id WHERE r.id=?",[roundId]);
    assert.equal(final[0].status,"CLOSED");
    assert.equal(final[0].observed_value,"7.42");
    assert.equal(final[0].provider_expected_value,"8.00");
    assert.equal(final[0].assessment,"UNSATISFACTORY");
    assert.equal(final[0].component_name_en_snapshot,"Original En");
    assert.equal(final[0].reviewed_by_user_id,reviewer);
    const [audits]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT action,actor_user_id FROM audit_events WHERE id IN (?,?)",[submitAudit,reviewAudit]);
    assert.equal(audits.length,2);
    assert.equal(audits.find(a=>a.action==="EQA_ROUND_SUBMITTED")?.actor_user_id,submitter);
    assert.equal(audits.find(a=>a.action==="EQA_ROUND_INDEPENDENTLY_REVIEWED")?.actor_user_id,reviewer);
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),competitor.rollback().catch(()=>{})]);
    for(const id of eventIds)await db.execute("DELETE FROM audit_events WHERE id=?",[id]).catch(()=>{});
    for(const {table,id} of cleanup) {
      if(table==="user_branch_scopes") {
        const [userId,branchId]=id.split("|");
        await db.execute("DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",
          [userId,branchId]).catch(()=>{});
      } else await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
    }
    await Promise.all([db.end(),competitor.end()]);
  }
});
