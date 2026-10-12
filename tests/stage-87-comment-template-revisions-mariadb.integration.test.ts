import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { commentTemplateReviewFingerprint, commentTransitionError } from "../src/lib/comment-template-approval.ts";
import { revisionCode, validateCommentRevisionSource } from "../src/lib/comment-template-revisions.ts";

test("Stage 87 MariaDB: one immutable successor, independent approval/retirement and no historical clinical overwrite",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [db,racer]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),testId=randomUUID(),
    componentId=randomUUID(),creator=randomUUID(),reviewer=randomUUID(),
    parentId=randomUUID(),childId=randomUUID(),illegalId=randomUUID(),suffix=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[],auditIds:string[]=[];
  async function insert(table:string,id:string,sql:string,args:(string|number|null)[]){
    await db.execute(sql,args);cleanup.unshift({table,id});
  }
  try{
    for(const [id,s] of [[org,"A"],[foreignOrg,"B"]])await insert("organizations",id,
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,"S87"+suffix+s,"Stage87 Organization"]);
    await insert("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S87"+suffix,"Stage87 Branch"]);
    for(const [id,s] of [[creator,"C"],[reviewer,"R"]])await insert("users",id,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id,org,"s87"+suffix+s,"Stage87 Staff"]);
    await insert("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,"S87TEST","Stage87 Test"]);
    await insert("test_components",componentId,
      "INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [componentId,testId,"S87COMP","Stage87 Component"]);
    await insert("result_comment_templates",parentId,
      "INSERT INTO result_comment_templates(id,organization_id,code,name_en,name_ar,text_en,text_ar,scope,test_id,component_id,status,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,?,?,?,'ACTIVE',NOW(3))",
      [parentId,org,"S87BASE","Original","الأصل","Original EN clinical text","النص الأصلي","COMPONENT",testId,componentId]);
    const [oldRows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM result_comment_templates WHERE id=? AND organization_id=?",[parentId,org]);
    const old=oldRows[0];
    assert.equal(old.revision_number,1);
    assert.equal(old.supersedes_template_id,null);
    const predecessor={
      id:old.id,organizationId:org,code:old.code,scope:"COMPONENT" as const,
      testId,componentId,nameEn:old.name_en,nameAr:old.name_ar,
      textEn:old.text_en,textAr:old.text_ar,status:"ACTIVE" as const,
      updatedAt:new Date(old.updated_at),revisionNumber:1,supersedesTemplateId:null,
    };
    const fingerprint=commentTemplateReviewFingerprint(predecessor);
    const proposed={id:parentId,expectedFingerprint:fingerprint,
      reason:"Correct interpretive language based on approved review",
      nameEn:"Corrected",nameAr:"مصحح",textEn:"Corrected clinical text",
      textAr:"نص سريري مصحح"};
    assert.equal(validateCommentRevisionSource(predecessor,proposed,fingerprint,true),null);
    const [foreign]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM result_comment_templates WHERE id=? AND organization_id=?",[parentId,foreignOrg]);
    assert.equal(foreign.length,0);
    await db.beginTransaction();
    const [parentLock]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM result_comment_templates WHERE id=? AND organization_id=? FOR UPDATE",
      [parentId,org]);
    assert.equal(parentLock.length,1);
    await racer.query("SET innodb_lock_wait_timeout=1");
    await racer.beginTransaction();
    let concurrentBlocked=false;
    try {
      await racer.execute("UPDATE result_comment_templates SET status='INACTIVE' WHERE id=?",
        [parentId]);
    } catch { concurrentBlocked=true; }
    await racer.rollback();
    assert.equal(concurrentBlocked,true,"parent cannot be concurrently retired during drafting");
    const newCode=revisionCode(old.code,2);
    await db.execute(
      "INSERT INTO result_comment_templates(id,organization_id,code,name_en,name_ar,text_en,text_ar,scope,test_id,component_id,status,deactivated_at,revision_number,supersedes_template_id,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,?,?,?,'INACTIVE',NOW(3),2,?,NOW(3))",
      [childId,org,newCode,proposed.nameEn,proposed.nameAr,proposed.textEn,proposed.textAr,
        "COMPONENT",testId,componentId,parentId]);
    cleanup.unshift({table:"result_comment_templates",id:childId});
    const creationId=randomUUID();auditIds.push(creationId);
    await db.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,reason,new_values) "+
      "VALUES(?,?,?,?,'RESULT_COMMENT_TEMPLATE_REVISION_CREATED','ResultCommentTemplate',?,?,?)",
      [creationId,org,branch,creator,childId,proposed.reason,JSON.stringify({parentId,revisionNumber:2})]);
    await db.commit();
    const [childRows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT * FROM result_comment_templates WHERE id=?",[childId]);
    const child=childRows[0];
    assert.equal(child.supersedes_template_id,parentId);
    assert.equal(child.revision_number,2);
    assert.equal(child.status,"INACTIVE");
    // Database unique predecessor key prohibits a second successor.
    await assert.rejects(db.execute(
      "INSERT INTO result_comment_templates(id,organization_id,code,name_en,text_en,scope,status,revision_number,supersedes_template_id,updated_at) "+
      "VALUES(?,?,?,'Fork','Forbidden','ORGANIZATION','INACTIVE',2,?,NOW(3))",
      [illegalId,org,"S87FORK",parentId]));
    const newEvidence={id:childId,organizationId:org,code:newCode,scope:"COMPONENT" as const,
      testId,componentId,nameEn:proposed.nameEn,nameAr:proposed.nameAr,
      textEn:proposed.textEn,textAr:proposed.textAr,status:"INACTIVE" as const,
      updatedAt:new Date(child.updated_at),revisionNumber:2,supersedesTemplateId:parentId};
    const attestation={status:"ACTIVE" as const,reason:"Independently reviewed exact revision and linked target",
      expectedFingerprint:commentTemplateReviewFingerprint(newEvidence),
      confirmation:"APPROVE_REVISION_AND_RETIRE_PREDECESSOR"};
    assert.equal(commentTransitionError(newEvidence,attestation,creator,reviewer,true),null);
    assert.equal(commentTransitionError(newEvidence,attestation,creator,creator,true),
      "comment_template_self_approval_forbidden");
    await db.beginTransaction();
    const [switched]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE result_comment_templates SET status='ACTIVE',deactivated_at=NULL,updated_at=NOW(3) "+
      "WHERE id=? AND organization_id=? AND status='INACTIVE'",[childId,org]);
    assert.equal(switched.affectedRows,1);
    const [retired]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE result_comment_templates SET status='INACTIVE',deactivated_at=NOW(3),updated_at=NOW(3) "+
      "WHERE id=? AND organization_id=? AND status='ACTIVE'",[parentId,org]);
    assert.equal(retired.affectedRows,1);
    for(const [id,entityId,action] of [
      [randomUUID(),parentId,"RESULT_COMMENT_TEMPLATE_SUPERSEDED"],
      [randomUUID(),childId,"RESULT_COMMENT_TEMPLATE_CLINICALLY_APPROVED"],
    ]) {
      auditIds.push(id);
      await db.execute(
        "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,reason,new_values) "+
        "VALUES(?,?,?,? ,?,'ResultCommentTemplate',?,?,?)",
        [id,org,branch,reviewer,action,entityId,attestation.reason,JSON.stringify({revisionNumber:2})]);
    }
    await db.commit();
    const [history]=await racer.execute<mysql.RowDataPacket[]>(
      "SELECT id,text_en,text_ar,status,revision_number,supersedes_template_id "+
      "FROM result_comment_templates WHERE id IN (?,?) ORDER BY revision_number",[parentId,childId]);
    assert.equal(history.length,2);
    assert.equal(history[0].status,"INACTIVE");
    assert.equal(history[0].text_en,"Original EN clinical text");
    assert.equal(history[0].text_ar,"النص الأصلي");
    assert.equal(history[1].status,"ACTIVE");
    assert.equal(history[1].text_en,"Corrected clinical text");
    const [audits]=await racer.execute<mysql.RowDataPacket[]>(
      "SELECT action,actor_user_id FROM audit_events WHERE organization_id=? AND entity_id IN (?,?)",
      [org,parentId,childId]);
    assert.equal(audits.length,3);
    assert.equal(audits.find(e=>e.action==="RESULT_COMMENT_TEMPLATE_REVISION_CREATED")?.actor_user_id,creator);
    assert.equal(audits.find(e=>e.action==="RESULT_COMMENT_TEMPLATE_SUPERSEDED")?.actor_user_id,reviewer);
    assert.equal(audits.find(e=>e.action==="RESULT_COMMENT_TEMPLATE_CLINICALLY_APPROVED")?.actor_user_id,reviewer);
    const [retry]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE result_comment_templates SET status='ACTIVE' WHERE id=? AND status='ACTIVE' AND revision_number=1",
      [parentId]);
    assert.equal(retry.affectedRows,0);
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),racer.rollback().catch(()=>{})]);
    for(const id of auditIds)await db.execute("DELETE FROM audit_events WHERE id=?",[id]).catch(()=>{});
    for(const {table,id} of cleanup)await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
    await Promise.all([db.end(),racer.end()]);
  }
});
