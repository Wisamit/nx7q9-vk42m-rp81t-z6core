import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {planReferenceIntervalApproval} from "../src/lib/reference-interval-governance.ts";

const randomCode=(prefix:string,id:string)=>prefix+id.slice(0,8).toUpperCase();
type Row={id:string;effective_from:Date;effective_to:Date|null};
const context=(row:Row)=>({
  id:row.id,branchId:null,methodId:null,analyzerId:null,specimenTypeId:null,
  sex:"ANY",ageFrom:null,ageTo:null,ageUnit:null,pregnancyStatus:null,
  gestationalAgeFromWeeks:null,gestationalAgeToWeeks:null,populationCode:null,
  effectiveFrom:row.effective_from,effectiveTo:row.effective_to,
});

test("F8 §75 MariaDB: two simultaneous approval attempts cannot publish overlapping clinical intervals",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const cfg={host:uri.hostname,port:Number(uri.port||3306),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
    database:uri.pathname.slice(1),timezone:"Z"};
  const [setup,winner,rival]=await Promise.all([
    mysql.createConnection(cfg),mysql.createConnection(cfg),mysql.createConnection(cfg),
  ]);
  const org=randomUUID(),branch=randomUUID(),testId=randomUUID(),component=randomUUID(),
    old=randomUUID(),draftA=randomUUID(),draftB=randomUUID(),created:string[]=[];
  const dateA="2026-01-01 00:00:00.000",dateNew="2026-06-01 00:00:00.000";
  try{
    await setup.execute(
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,randomCode("F8GO",org),"Synthetic Interval Lock Organization"]);
    created.push("organizations");
    await setup.execute(
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,randomCode("F8GB",branch),"Synthetic Branch"]);
    created.push("branches");
    await setup.execute(
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,randomCode("F8GT",testId),"Synthetic Interval Test"]);
    created.push("lab_tests");
    await setup.execute(
      "INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [component,testId,randomCode("F8GC",component),"Synthetic Component"]);
    created.push("test_components");
    for(const [id,from,status,approval] of [
      [old,dateA,"ACTIVE","APPROVED"],
      [draftA,dateNew,"INACTIVE","DRAFT"],
      [draftB,dateNew,"INACTIVE","DRAFT"],
    ]){
      await setup.execute(
        "INSERT INTO reference_intervals(id,component_id,effective_from,status,approval_status,updated_at,approved_at) "+
        "VALUES(?,?,?,?,?,NOW(3),?)",
        [id,component,from,status,approval,approval==="APPROVED"?new Date("2026-01-01T00:00:00.000Z"):null]);
    }
    created.push("reference_intervals");
    await rival.query("SET SESSION innodb_lock_wait_timeout = 1");

    await winner.beginTransaction();
    const [tenant]=await winner.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(tenant.length,1);
    const [activeBranches]=await winner.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM branches WHERE organization_id=? AND status='ACTIVE' ORDER BY id FOR UPDATE",[org]);
    assert.equal(activeBranches.length,1);
    const [parent]=await winner.execute<mysql.RowDataPacket[]>(
      "SELECT c.id FROM test_components c JOIN lab_tests t ON t.id=c.test_id "+
      "WHERE c.id=? AND c.status='ACTIVE' AND t.organization_id=? AND t.status='ACTIVE' FOR UPDATE",
      [component,org]);
    assert.equal(parent.length,1);
    const [firstSource]=await winner.execute<mysql.RowDataPacket[]>(
      "SELECT id,effective_from,effective_to FROM reference_intervals WHERE id=? FOR UPDATE",
      [draftA]);
    const [before]=await winner.execute<mysql.RowDataPacket[]>(
      "SELECT id,effective_from,effective_to FROM reference_intervals "+
      "WHERE component_id=? AND status='ACTIVE' AND approval_status='APPROVED'",
      [component]);
    const planA=planReferenceIntervalApproval(context(firstSource[0] as Row),before.map(x=>context(x as Row)));
    assert.deepEqual(planA,{predecessorsToClose:[old],conflicts:[]});

    await rival.beginTransaction();
    await assert.rejects(async()=>{
      await rival.execute(
        "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    },(error:unknown)=>Boolean(error && typeof error==="object" &&
      "code" in error && error.code==="ER_LOCK_WAIT_TIMEOUT"));
    await rival.rollback();
    // The winning approval, predecessor closure and journal are one transaction.
    const [closed]=await winner.execute<mysql.ResultSetHeader>(
      "UPDATE reference_intervals SET effective_to=DATE_SUB(?,INTERVAL 1000 MICROSECOND) "+
      "WHERE id=? AND approval_status='APPROVED' AND status='ACTIVE' AND effective_to IS NULL",
      [dateNew,old]);
    assert.equal(closed.affectedRows,1);
    const [published]=await winner.execute<mysql.ResultSetHeader>(
      "UPDATE reference_intervals SET approval_status='APPROVED',status='ACTIVE',approved_at=NOW(3) "+
      "WHERE id=? AND approval_status='DRAFT' AND status='INACTIVE'",[draftA]);
    assert.equal(published.affectedRows,1);
    await winner.execute(
      "INSERT INTO audit_events(organization_id,action,entity_type,entity_id) "+
      "VALUES(?,'REFERENCE_INTERVAL_APPROVED','ReferenceInterval',?)",[org,draftA]);
    await winner.commit();

    await rival.beginTransaction();
    const [freshTenant]=await rival.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(freshTenant.length,1);
    const [secondSource]=await rival.execute<mysql.RowDataPacket[]>(
      "SELECT id,effective_from,effective_to FROM reference_intervals WHERE id=? FOR UPDATE",
      [draftB]);
    const [after]=await rival.execute<mysql.RowDataPacket[]>(
      "SELECT id,effective_from,effective_to FROM reference_intervals "+
      "WHERE component_id=? AND status='ACTIVE' AND approval_status='APPROVED'",
      [component]);
    const planB=planReferenceIntervalApproval(context(secondSource[0] as Row),
      after.map(x=>context(x as Row)));
    assert.ok(planB.conflicts.includes(draftA),
      "same-start approved row must block second concurrent approval");
    await rival.rollback();

    const [statuses]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT id,approval_status,status FROM reference_intervals WHERE component_id=?",[component]);
    const map=new Map(statuses.map(x=>[x.id,x]));
    assert.equal(map.get(draftA)?.approval_status,"APPROVED");
    assert.equal(map.get(draftB)?.approval_status,"DRAFT");
    assert.equal(map.get(draftB)?.status,"INACTIVE");
    const [audits]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT entity_id FROM audit_events WHERE organization_id=? "+
      "AND action='REFERENCE_INTERVAL_APPROVED'",[org]);
    assert.deepEqual(audits.map(x=>x.entity_id),[draftA]);
  }finally{
    await Promise.all([winner.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
    await setup.execute("DELETE FROM audit_events WHERE organization_id=?",[org]).catch(()=>{});
    if(created.includes("reference_intervals"))
      await setup.execute("DELETE FROM reference_intervals WHERE component_id=?",[component]).catch(()=>{});
    if(created.includes("test_components"))
      await setup.execute("DELETE FROM test_components WHERE id=?",[component]).catch(()=>{});
    if(created.includes("lab_tests"))
      await setup.execute("DELETE FROM lab_tests WHERE id=?",[testId]).catch(()=>{});
    if(created.includes("branches"))
      await setup.execute("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    if(created.includes("organizations"))
      await setup.execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([setup.end(),winner.end(),rival.end()]);
  }
});
