import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 78 MariaDB: competing critical attempts cannot acknowledge, escalate or audit a stale event",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const cfg={host:uri.hostname,port:Number(uri.port||3306),user:decodeURIComponent(uri.username),
    password:decodeURIComponent(uri.password),database:uri.pathname.slice(1)};
  const [setup,operatorA,operatorB]=await Promise.all([
    mysql.createConnection(cfg),mysql.createConnection(cfg),mysql.createConnection(cfg),
  ]);
  const org=randomUUID(),branch=randomUUID(),user=randomUUID(),patient=randomUUID(),
    order=randomUUID(),testId=randomUUID(),item=randomUUID(),result=randomUUID(),
    event=randomUUID(),suffix=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  const createdLogs:string[]=[];
  async function put(table:string,id:string,sql:string,parameters:Array<string|number|null>){
    await setup.execute(sql,parameters);
    cleanup.unshift({table,id});
  }
  async function state(){
    const [rows]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status,escalation_level,updated_at,acknowledged_at,next_escalation_due_at "+
      "FROM critical_result_events WHERE id=?",[event]);
    assert.equal(rows.length,1);
    return {status:String(rows[0].status),level:Number(rows[0].escalation_level),
      updatedAt:new Date(rows[0].updated_at)};
  }
  type Intent="ACKNOWLEDGED"|"ESCALATED"|"NO_ANSWER";
  async function attempt(conn:mysql.Connection,view:Awaited<ReturnType<typeof state>>,
    outcome:Intent){
    await conn.beginTransaction();
    try{
      const communicatedAt=new Date(Math.max(Date.now(),view.updatedAt.getTime()+2));
      const stamp=new Date(Math.max(communicatedAt.getTime(),view.updatedAt.getTime()+1));
      const acknowledged=outcome==="ACKNOWLEDGED";
      const escalated=outcome==="ESCALATED";
      const [claimed]=await conn.execute<mysql.ResultSetHeader>(
        "UPDATE critical_result_events e "+
        "JOIN laboratory_results r ON r.id=e.result_id "+
        "SET e.updated_at=?,e.status=IF(?=1,'ACKNOWLEDGED',e.status),"+
        "e.acknowledged_at=IF(?=1,?,e.acknowledged_at),"+
        "e.acknowledged_by_user_id=IF(?=1,?,e.acknowledged_by_user_id),"+
        "e.escalation_level=IF(?=1,e.escalation_level+1,e.escalation_level),"+
        "e.next_escalation_due_at=IF(?=1,NULL,IF(?=1,?,e.next_escalation_due_at)) "+
        "WHERE e.id=? AND e.result_id=? AND e.status='OPEN' "+
        "AND e.escalation_level=? AND e.updated_at=? "+
        "AND r.organization_id=? AND r.performing_branch_id=? "+
        "AND (r.status IN ('VERIFIED','RELEASED') OR "+
        "(r.status='ENTERED' AND r.validation_stage='MEDICAL_VALIDATION'))",
        [stamp,Number(acknowledged),Number(acknowledged),communicatedAt,
          Number(acknowledged),user,Number(escalated),Number(acknowledged),
          Number(escalated),new Date(communicatedAt.getTime()+60000),
          event,result,view.level,view.updatedAt,org,branch]);
      if(claimed.affectedRows!==1){
        await conn.rollback();
        return false;
      }
      const communicationId=randomUUID(),auditId=randomUUID();
      await conn.execute(
        "INSERT INTO critical_result_communications(id,critical_event_id,method,outcome,recipient_name,"+
        "acknowledgement_confirmed,read_back_confirmed,communicated_by_user_id,communicated_at) "+
        "VALUES(?,?,'PHONE',?,'Clinical reviewer',?,?,?,?)",
        [communicationId,event,outcome,Number(acknowledged),0,user,communicatedAt]);
      await conn.execute(
        "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) "+
        "VALUES(?,?,?,?, 'CRITICAL_RESULT_COMMUNICATED','CriticalResultEvent',?,?)",
        [auditId,org,branch,user,event,JSON.stringify({outcome,communicationId})]);
      await conn.commit();
      createdLogs.push(communicationId,auditId);
      return true;
    }catch(e){await conn.rollback();throw e;}
  }
  try{
    await put("organizations",org,
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"S78"+suffix,"Stage78 Tenant"]);
    await put("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S78"+suffix,"Stage78 Branch"]);
    await put("users",user,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [user,org,"s78"+suffix,"Stage78 Reviewer"]);
    await put("patients",patient,
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [patient,org,"S78"+suffix,"Stage78 Patient","stage78 patient"]);
    await put("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,"S78"+suffix,"Critical test"]);
    await put("orders",order,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [order,org,"S78"+suffix,branch,patient,user]);
    await put("order_items",item,
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
      [item,order,testId,"CRIT","Critical test"]);
    await put("laboratory_results",result,
      "INSERT INTO laboratory_results(id,organization_id,order_item_id,performing_branch_id,entered_by_user_id,status,updated_at) VALUES(?,?,?,?,?,'RELEASED',NOW(3))",
      [result,org,item,branch,user]);
    await put("critical_result_events",event,
      "INSERT INTO critical_result_events(id,result_id,status,critical_value_snapshot,escalation_level,max_escalation_level_snapshot,"+
      "require_read_back_snapshot,updated_at) VALUES(?,?,'OPEN','[]',0,4,0,NOW(3))",
      [event,result]);
    const before=await state();
    const competing=await Promise.all([
      attempt(operatorA,before,"ESCALATED"),
      attempt(operatorB,before,"ACKNOWLEDGED"),
    ]);
    assert.equal(competing.filter(Boolean).length,1);
    const after=await state();
    assert.equal(after.level,competing[0]?1:0);
    assert.equal(after.status,competing[1]?"ACKNOWLEDGED":"OPEN");
    assert.notEqual(after.updatedAt.getTime(),before.updatedAt.getTime());
    assert.equal(await attempt(operatorA,before,"NO_ANSWER"),false);
    if(after.status==="OPEN"){
      assert.equal(await attempt(operatorB,after,"ACKNOWLEDGED"),true);
    }
    const closed=await state();
    assert.equal(closed.status,"ACKNOWLEDGED");
    assert.equal(await attempt(operatorA,closed,"ESCALATED"),false);
    assert.equal(await attempt(operatorB,closed,"NO_ANSWER"),false);
    const [com]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT outcome FROM critical_result_communications WHERE critical_event_id=?",[event]);
    const [aud]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT action FROM audit_events WHERE entity_type='CriticalResultEvent' AND entity_id=?",[event]);
    assert.equal(com.length,competing[0]?2:1);
    assert.equal(aud.length,com.length);
    assert.equal(com.filter(x=>x.outcome==="ACKNOWLEDGED").length,1);
    assert.ok(aud.every(x=>x.action==="CRITICAL_RESULT_COMMUNICATED"));

    // Changing result eligibility is also guarded at claim time. No ghost
    // records may be added merely because an old UI saw a released result.
    await setup.execute("UPDATE critical_result_events SET status='OPEN',escalation_level=0,updated_at=DATE_ADD(updated_at, INTERVAL 10 MILLISECOND) WHERE id=?",[event]);
    await setup.execute("UPDATE laboratory_results SET status='DRAFT' WHERE id=?",[result]);
    assert.equal(await attempt(operatorA,await state(),"ESCALATED"),false);
    const [auditAfter]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE entity_type='CriticalResultEvent' AND entity_id=?",[event]);
    assert.equal(auditAfter.length,aud.length);
  }finally{
    await Promise.all([operatorA.rollback().catch(()=>{}),operatorB.rollback().catch(()=>{})]);
    await setup.execute("DELETE FROM audit_events WHERE entity_type='CriticalResultEvent' AND entity_id=?",[event]).catch(()=>{});
    await setup.execute("DELETE FROM critical_result_communications WHERE critical_event_id=?",[event]).catch(()=>{});
    for(const row of cleanup) await setup.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([setup.end(),operatorA.end(),operatorB.end()]);
  }
});
