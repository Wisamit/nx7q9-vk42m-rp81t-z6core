import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  commentReviewBlocker, decodeCommentReviewCursor, encodeCommentReviewCursor,
} from "../src/lib/comment-template-review-queue.ts";

test("Stage 86 MariaDB: tenant-bound active clinical targets, locked draft creation and independent review evidence",{
  timeout:75000,
}, async()=>{
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host:url.hostname, port:Number(url.port||3306),
    user:decodeURIComponent(url.username), password:decodeURIComponent(url.password),
    database:url.pathname.slice(1) };
  const [db,competing]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),outside=randomUUID(),branch=randomUUID(),
    creator=randomUUID(),reviewer=randomUUID(),testId=randomUUID(),
    componentId=randomUUID(),templateId=randomUUID(),suffix=org.slice(0,8);
  const remove:Array<{table:string;id:string}>=[];
  const events:string[]=[];
  async function create(table:string,id:string,sql:string,args:(string|number|null)[]){
    await db.execute(sql,args); remove.unshift({table,id});
  }
  const targetQuery="SELECT t.id AS test_id, c.id AS component_id "+
    "FROM lab_tests t JOIN test_components c ON c.test_id=t.id "+
    "WHERE t.id=? AND t.organization_id=? AND t.status='ACTIVE' "+
    "AND c.id=? AND c.status='ACTIVE'";
  try{
    for(const [id,s] of [[org,"A"],[outside,"B"]]){
      await create("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S86"+suffix+s,"Stage86 lab organization"]);
    }
    await create("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S86"+suffix,"Stage86 Branch"]);
    for(const [id,s] of [[creator,"C"],[reviewer,"R"]]){
      await create("users",id,
        "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"s86"+suffix+s,"Stage86 reviewer"]);
    }
    await create("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,"S86TEST","Stage86 Test"]);
    await create("test_components",componentId,
      "INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [componentId,testId,"S86COMP","Stage86 Component"]);
    const [permitted]=await db.execute<mysql.RowDataPacket[]>(targetQuery,[testId,org,componentId]);
    const [otherTenant]=await db.execute<mysql.RowDataPacket[]>(targetQuery,[testId,outside,componentId]);
    const [wrongComponent]=await db.execute<mysql.RowDataPacket[]>(targetQuery,[testId,org,randomUUID()]);
    assert.equal(permitted.length,1);
    assert.equal(otherTenant.length,0);
    assert.equal(wrongComponent.length,0);
    // The API first locks active organization/branch/test/component, then inserts.
    await db.beginTransaction();
    const [lockedOrg]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    const [lockedBranch]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM branches WHERE id=? AND organization_id=? AND status='ACTIVE' FOR UPDATE",[branch,org]);
    const [lockedTest]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=? AND status='ACTIVE' FOR UPDATE",[testId,org]);
    const [lockedComponent]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM test_components WHERE id=? AND test_id=? AND status='ACTIVE' FOR UPDATE",[componentId,testId]);
    assert.equal(lockedOrg.length,1);assert.equal(lockedBranch.length,1);
    assert.equal(lockedTest.length,1);assert.equal(lockedComponent.length,1);
    await competing.query("SET innodb_lock_wait_timeout=1");
    await competing.beginTransaction();
    let cannotDeactivateDuringCreate=false;
    try { await competing.execute("UPDATE lab_tests SET status='INACTIVE' WHERE id=?",[testId]); }
    catch { cannotDeactivateDuringCreate=true; }
    await competing.rollback();
    assert.equal(cannotDeactivateDuringCreate,true);
    await db.execute(
      "INSERT INTO result_comment_templates(id,organization_id,code,name_en,name_ar,text_en,text_ar,scope,test_id,component_id,status,deactivated_at,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,?,?,?,'INACTIVE',NOW(3),NOW(3))",
      [templateId,org,"S86COMMENT","Interpretive draft","مسودة","Reviewed text","نص سريري","COMPONENT",testId,componentId]);
    remove.unshift({table:"result_comment_templates",id:templateId});
    const auditId=randomUUID();events.push(auditId);
    await db.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) "+
      "VALUES(?,?,?,?,'RESULT_COMMENT_TEMPLATE_CREATED','ResultCommentTemplate',?,?)",
      [auditId,org,branch,creator,templateId,JSON.stringify({status:"INACTIVE"})]);
    await db.commit();
    const [stored]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT c.*, t.status AS test_status,t.organization_id AS test_org, p.status AS component_status,p.test_id AS linked_test "+
      "FROM result_comment_templates c LEFT JOIN lab_tests t ON t.id=c.test_id "+
      "LEFT JOIN test_components p ON p.id=c.component_id "+
      "WHERE c.id=? AND c.organization_id=?",[templateId,org]);
    assert.equal(stored.length,1);
    assert.equal(stored[0].status,"INACTIVE");
    assert.equal(stored[0].text_ar,"نص سريري");
    assert.equal(stored[0].test_org,org);
    const [origin]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT actor_user_id, action FROM audit_events WHERE organization_id=? AND entity_id=? "+
      "AND action='RESULT_COMMENT_TEMPLATE_CREATED'",[org,templateId]);
    assert.equal(origin.length,1);
    assert.equal(origin[0].actor_user_id,creator);
    const target={
      id:stored[0].id,organizationId:stored[0].organization_id,code:stored[0].code,
      scope:stored[0].scope,testId:stored[0].test_id,componentId:stored[0].component_id,
      nameEn:stored[0].name_en,nameAr:stored[0].name_ar,textEn:stored[0].text_en,
      textAr:stored[0].text_ar,status:stored[0].status,updatedAt:new Date(stored[0].updated_at),
      test:{id:testId,organizationId:org,status:stored[0].test_status},
      component:{id:componentId,testId:stored[0].linked_test,status:stored[0].component_status},
    };
    assert.equal(commentReviewBlocker(target,origin[0].actor_user_id,creator),"SELF_APPROVAL");
    assert.equal(commentReviewBlocker(target,origin[0].actor_user_id,reviewer),null);
    assert.equal(commentReviewBlocker({...target,test:{...target.test,organizationId:outside}},
      creator,reviewer),"TARGET_INACTIVE_OR_INVALID");
    const [outsideTemplate]=await competing.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM result_comment_templates WHERE id=? AND organization_id=?",
      [templateId,outside]);
    assert.equal(outsideTemplate.length,0);
    await db.execute("UPDATE test_components SET status='INACTIVE' WHERE id=?",[componentId]);
    const [inactive]=await db.execute<mysql.RowDataPacket[]>(targetQuery,[testId,org,componentId]);
    assert.equal(inactive.length,0);
    assert.equal(commentReviewBlocker({...target,component:{...target.component,status:"INACTIVE"}},
      creator,reviewer),"TARGET_INACTIVE_OR_INVALID");
    const cursor=encodeCommentReviewCursor({createdAt:new Date("2026-10-12T12:00:00.000Z"),id:templateId});
    assert.equal(decodeCommentReviewCursor(cursor)?.id,templateId);
    // Neither the approval queue nor draft creation modifies released result data.
    const [auditRows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT action FROM audit_events WHERE organization_id=? AND entity_id=?",[org,templateId]);
    assert.deepEqual(auditRows.map(x=>x.action),["RESULT_COMMENT_TEMPLATE_CREATED"]);
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),competing.rollback().catch(()=>{})]);
    for(const id of events) await db.execute("DELETE FROM audit_events WHERE id=?",[id]).catch(()=>{});
    for(const {table,id} of remove) await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
    await Promise.all([db.end(),competing.end()]);
  }
});
