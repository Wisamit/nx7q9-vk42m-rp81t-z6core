import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  commentTemplateReviewFingerprint, commentTransitionError,
  type CommentTemplateEvidence,
} from "../src/lib/comment-template-approval.ts";

test("Stage 85 MariaDB: independent activation locks comment revision, denies competing approver and preserves immutable audit",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [writer,competitor]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),
    creator=randomUUID(),reviewer=randomUUID(),testId=randomUUID(),componentId=randomUUID(),
    templateId=randomUUID(),suffix=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  const auditIds:string[]=[];
  async function insert(table:string,id:string,sql:string,args:(string|number|null)[]){
    await writer.execute(sql,args);
    cleanup.unshift({table,id});
  }
  const templateRow=async()=>{
    const [rows]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM result_comment_templates WHERE id=? AND organization_id=?",[templateId,org]);
    return rows[0];
  };
  try{
    for(const [id,s] of [[org,"A"],[foreignOrg,"B"]])await insert(
      "organizations",id,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,"S85"+suffix+s,"Stage85 test organization"]);
    await insert("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S85"+suffix,"Test Branch"]);
    for(const [id,s] of [[creator,"C"],[reviewer,"R"]])await insert("users",id,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id,org,"s85"+suffix+s,"Stage85 staff"]);
    await insert("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,"TEST85","Test 85"]);
    await insert("test_components",componentId,
      "INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [componentId,testId,"COMP85","Component 85"]);
    await insert("result_comment_templates",templateId,
      "INSERT INTO result_comment_templates(id,organization_id,code,name_en,name_ar,text_en,text_ar,scope,test_id,component_id,status,deactivated_at,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,?,?,?,'INACTIVE',NOW(3),NOW(3))",
      [templateId,org,"COMMENT85","Comment85","تعليق", "Review clinically","مراجعة سريرية","COMPONENT",testId,componentId]);
    const creationAudit=randomUUID();auditIds.push(creationAudit);
    await writer.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) "+
      "VALUES(?,?,?,?,'LEGACY_MASTER_RECORD_CREATED','COMMENT_TEMPLATE',?,?)",
      [creationAudit,org,branch,creator,templateId,JSON.stringify({status:"INACTIVE"})]);
    const original=await templateRow();
    const asEvidence=(row:mysql.RowDataPacket):CommentTemplateEvidence=>({
      id:row.id,organizationId:row.organization_id,code:row.code,scope:row.scope,
      testId:row.test_id,componentId:row.component_id,
      nameEn:row.name_en,nameAr:row.name_ar,textEn:row.text_en,
      textAr:row.text_ar,status:row.status,updatedAt:new Date(row.updated_at),
    });
    const originalEvidence=asEvidence(original);
    const fingerprint=commentTemplateReviewFingerprint(originalEvidence);
    const decision={status:"ACTIVE" as const,expectedFingerprint:fingerprint,
      reason:"Second reviewer verified full English and Arabic wording",
      confirmation:"APPROVE_EXACT_BILINGUAL_CLINICAL_TEXT"};
    assert.equal(commentTransitionError(originalEvidence,decision,creator,creator,true),
      "comment_template_self_approval_forbidden");
    assert.equal(commentTransitionError(originalEvidence,decision,creator,reviewer,true),null);
    const [targets]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT t.id FROM lab_tests t JOIN test_components c ON c.test_id=t.id "+
      "WHERE t.id=? AND t.organization_id=? AND t.status='ACTIVE' AND c.id=? AND c.status='ACTIVE'",
      [testId,org,componentId]);
    assert.equal(targets.length,1);
    const [outside]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM result_comment_templates WHERE id=? AND organization_id=?",
      [templateId,foreignOrg]);
    assert.equal(outside.length,0);
    await writer.beginTransaction();
    const [locked]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id,status FROM result_comment_templates WHERE id=? AND organization_id=? FOR UPDATE",
      [templateId,org]);
    assert.equal(locked.length,1);
    await competitor.query("SET innodb_lock_wait_timeout = 1");
    await competitor.beginTransaction();
    let deniedConcurrent=false;
    try {
      await competitor.execute(
        "SELECT id FROM result_comment_templates WHERE id=? AND organization_id=? FOR UPDATE",
        [templateId,org]);
    }catch{deniedConcurrent=true;}
    await competitor.rollback();
    assert.equal(deniedConcurrent,true,"concurrent clinical approver cannot bypass the row lock");
    const [changed]=await writer.execute<mysql.ResultSetHeader>(
      "UPDATE result_comment_templates SET status='ACTIVE',deactivated_at=NULL,updated_at=NOW(3) "+
      "WHERE id=? AND organization_id=? AND status='INACTIVE' AND updated_at=?",
      [templateId,org,original.updated_at]);
    assert.equal(changed.affectedRows,1);
    const approvalAudit=randomUUID();auditIds.push(approvalAudit);
    await writer.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,reason,new_values) "+
      "VALUES(?,?,?,?,'RESULT_COMMENT_TEMPLATE_CLINICALLY_APPROVED','ResultCommentTemplate',?,?,?)",
      [approvalAudit,org,branch,reviewer,templateId,decision.reason,JSON.stringify({fingerprint,scope:"COMPONENT"})]);
    await writer.commit();
    const after=await templateRow();
    assert.equal(after.status,"ACTIVE");
    const [stale]=await competitor.execute<mysql.ResultSetHeader>(
      "UPDATE result_comment_templates SET status='ACTIVE' WHERE id=? AND organization_id=? AND status='INACTIVE'",
      [templateId,org]);
    assert.equal(stale.affectedRows,0);
    assert.equal(commentTransitionError(asEvidence(after),decision,creator,reviewer,true),
      "comment_template_state_changed");
    const [audits]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT action,actor_user_id,reason FROM audit_events WHERE organization_id=? AND entity_id=?",
      [org,templateId]);
    assert.equal(audits.length,2);
    assert.equal(audits.find(x=>x.action==="RESULT_COMMENT_TEMPLATE_CLINICALLY_APPROVED").actor_user_id,reviewer);
    assert.equal(audits.find(x=>x.action==="LEGACY_MASTER_RECORD_CREATED").actor_user_id,creator);
    // Retiring affects availability only; recorded result/report tables are never updated.
    const [retired]=await writer.execute<mysql.ResultSetHeader>(
      "UPDATE result_comment_templates SET status='INACTIVE',deactivated_at=NOW(3),updated_at=NOW(3) "+
      "WHERE id=? AND organization_id=? AND status='ACTIVE'",
      [templateId,org]);
    assert.equal(retired.affectedRows,1);
    assert.equal((await templateRow()).status,"INACTIVE");
  }finally{
    await Promise.all([writer.rollback().catch(()=>{}),competitor.rollback().catch(()=>{})]);
    for(const id of auditIds)await writer.execute("DELETE FROM audit_events WHERE id=?",[id]).catch(()=>{});
    for(const {table,id} of cleanup)await writer.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
    await Promise.all([writer.end(),competitor.end()]);
  }
});
