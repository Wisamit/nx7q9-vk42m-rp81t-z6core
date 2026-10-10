import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  bundleTriageClass, catalogDriftObservationToken, matchesCatalogDriftObservation,
} from "../src/lib/catalog-drift-triage.ts";

test("Stage 53 MariaDB two sessions: a revoked author cannot triage, a stale signed view cannot be flagged, and valid evidence is audit-only",
{timeout:45000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reviewer]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),dept=randomUUID(),
    testId=randomUUID(),foreignTest=randomUUID(),actor=randomUUID(),eventId=randomUUID();
  const prefix="S53"+org.slice(0,8);
  const key="stage-53-test-only-strong-hmac-signing-key-123";
  const checksum="a".repeat(64);
  const run=(sql:string,args:Array<string|number|null>)=>writer.execute(sql,args);
  try{
    for(const [id,suffix] of [[org,"O"],[foreignOrg,"F"]])
      await run("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+suffix,"Stage53 Tenant"]);
    await run("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,prefix+"B","Stage53 Branch"]);
    await run("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [dept,org,branch,prefix+"D","Stage53 Department"]);
    for(const [id,tenant,department,suffix] of [
      [testId,org,dept,"T"],[foreignTest,foreignOrg,null,"F"],
    ])await run("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id,tenant,department,prefix+suffix,"Before"]);
    await run("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor,org,prefix,"Stage53 Reviewer"]);
    await run("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[actor,branch]);
    await run("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",[actor,dept]);

    const source={id:testId,code:prefix+"T",nameEn:"Before"};
    const before={...source};
    const observed=catalogDriftObservationToken(key,checksum,1,"TEST",source,before);
    assert.equal(bundleTriageClass("TEST"),"CLINICAL");

    await writer.beginTransaction();
    const [held]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(held.length,1);
    await reviewer.execute("SET SESSION innodb_lock_wait_timeout=8");
    await reviewer.beginTransaction();
    const waiting=reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    await writer.execute("DELETE FROM user_department_scopes WHERE user_id=?",[actor]);
    await writer.execute("DELETE FROM user_branch_scopes WHERE user_id=?",[actor]);
    await writer.commit();
    const [acquired]=await waiting;
    assert.equal(acquired.length,1);
    const [revoked]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT branch_id FROM user_branch_scopes WHERE user_id=?",[actor]);
    assert.equal(revoked.length,0);
    await reviewer.commit();
    const [notFlagged]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE id=?",[eventId]);
    assert.equal(notFlagged.length,0);

    await run("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[actor,branch]);
    await run("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",[actor,dept]);
    await run("UPDATE lab_tests SET name_en='After' WHERE id=?",[testId]);
    await reviewer.beginTransaction();
    const [relocked]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]);
    assert.equal(relocked.length,1);
    const [scoped]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT t.id,t.code,t.name_en FROM lab_tests t JOIN user_department_scopes d ON d.department_id=t.department_id JOIN user_branch_scopes b ON b.branch_id=? WHERE t.id=? AND t.organization_id=? AND d.user_id=? AND b.user_id=?",
      [branch,testId,org,actor,actor]);
    assert.equal(scoped.length,1);
    const live={id:String(scoped[0].id),code:String(scoped[0].code),nameEn:String(scoped[0].name_en)};
    const recalculated=catalogDriftObservationToken(key,checksum,1,"TEST",source,live);
    assert.equal(matchesCatalogDriftObservation(observed,recalculated),false);
    const [foreign]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=?",[foreignTest,org]);
    assert.equal(foreign.length,0);

    // Client can only request review against this fresh observed state.
    assert.equal(matchesCatalogDriftObservation(recalculated,
      catalogDriftObservationToken(key,checksum,1,"TEST",source,live)),true);
    await reviewer.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED','CatalogImportRow',?,?)",
      [eventId,org,branch,actor,testId,JSON.stringify({
        category:"CLINICAL",reasonCode:"SOURCE_VALUE_CHANGED",disposition:"DRIFTED",
        evidenceToken:recalculated,approved:false,activated:false,reviewOnly:true,
      })]);
    await reviewer.commit();
    const [evidence]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT new_values AS evidence FROM audit_events WHERE id=? AND organization_id=?",
      [eventId,org]);
    assert.equal(evidence.length,1);
    const parsed=typeof evidence[0].evidence==="string"?JSON.parse(evidence[0].evidence):evidence[0].evidence;
    assert.equal(parsed.approved,false);
    assert.equal(parsed.activated,false);
    const [unchanged]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT name_en FROM lab_tests WHERE id=?",[testId]);
    assert.equal(unchanged[0].name_en,"After");
  }finally{
    await writer.rollback().catch(()=>{});
    await reviewer.rollback().catch(()=>{});
    await run("DELETE FROM audit_events WHERE id=?",[eventId]).catch(()=>{});
    await run("DELETE FROM user_department_scopes WHERE user_id=?",[actor]).catch(()=>{});
    await run("DELETE FROM user_branch_scopes WHERE user_id=?",[actor]).catch(()=>{});
    await run("DELETE FROM lab_tests WHERE id IN (?,?)",[testId,foreignTest]).catch(()=>{});
    await run("DELETE FROM departments WHERE id=?",[dept]).catch(()=>{});
    await run("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
    await run("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await run("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    await Promise.all([writer.end(),reviewer.end()]);
  }
});
