import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

const fixtureCode=(id:string,prefix:string)=>prefix+id.slice(0,8).toUpperCase();
test("F8 §86 MariaDB: published-tax branch and service locks prevent stale scope writes",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const settings={host:uri.hostname,port:Number(uri.port||3306),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
    database:uri.pathname.slice(1)};
  const [setup,publisher,changer]=await Promise.all([
    mysql.createConnection(settings),mysql.createConnection(settings),
    mysql.createConnection(settings)]);
  const org=randomUUID(),branch=randomUUID(),testId=randomUUID();
  let orgCreated=false,branchCreated=false,testCreated=false;
  try{
    await setup.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,fixtureCode(org,"TAXO"),"Synthetic Tax Lock Lab"]);orgCreated=true;
    await setup.execute("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,fixtureCode(branch,"TAXB"),"Synthetic Branch"]);branchCreated=true;
    await setup.execute("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,fixtureCode(testId,"TAXT"),"Synthetic Tax Test"]);testCreated=true;
    await changer.query("SET SESSION innodb_lock_wait_timeout=1");

    await publisher.beginTransaction();
    const [tenant]=await publisher.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    const [eligible]=await publisher.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM branches WHERE organization_id=? AND status='ACTIVE' ORDER BY id FOR UPDATE",[org]);
    const [service]=await publisher.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=? AND status='ACTIVE' FOR UPDATE",
      [testId,org]);
    assert.equal(tenant.length,1);
    assert.equal(eligible.length,1);
    assert.equal(service.length,1);
    // Concurrent branch disable would invalidate the old request preflight,
    // but cannot slip between current active-branch check and version bump.
    await assert.rejects(async()=>{
      await changer.execute("UPDATE branches SET status='INACTIVE' WHERE id=?",[branch]);
    },(error:unknown)=>Boolean(error&&typeof error==="object"&&
      "code" in error&&error.code==="ER_LOCK_WAIT_TIMEOUT"));
    await assert.rejects(async()=>{
      await changer.execute("UPDATE lab_tests SET status='INACTIVE' WHERE id=?",[testId]);
    },(error:unknown)=>Boolean(error&&typeof error==="object"&&
      "code" in error&&error.code==="ER_LOCK_WAIT_TIMEOUT"));
    const [bump]=await publisher.execute<mysql.ResultSetHeader>(
      "UPDATE branches SET tax_config_version=tax_config_version+1 "+
      "WHERE organization_id=? AND id=? AND status='ACTIVE'",[org,branch]);
    assert.equal(bump.affectedRows,1);
    await publisher.commit();
    const [after]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT tax_config_version,status FROM branches WHERE id=?",[branch]);
    assert.equal(after[0].tax_config_version,1);
    assert.equal(after[0].status,"ACTIVE");
    // Once the lock has gone, deactivation is visible and a fresh
    // publication MUST no longer be able to bind the old active scope.
    await changer.execute("UPDATE branches SET status='INACTIVE' WHERE id=?",[branch]);
    const [stale]=await publisher.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM branches WHERE organization_id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(stale.length,0);
    const [blocked]=await publisher.execute<mysql.ResultSetHeader>(
      "UPDATE branches SET tax_config_version=tax_config_version+1 "+
      "WHERE organization_id=? AND id=? AND status='ACTIVE'",[org,branch]);
    assert.equal(blocked.affectedRows,0);
    // No TaxRule, Invoice, posted pricing, or clinical history is created.
    const [rules]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM tax_rules WHERE organization_id=?",[org]);
    assert.equal(Number(rules[0].n),0);
  }finally{
    await Promise.all([publisher.rollback().catch(()=>{}),changer.rollback().catch(()=>{})]);
    if(testCreated)await setup.execute("DELETE FROM lab_tests WHERE id=?",[testId]).catch(()=>{});
    if(branchCreated)await setup.execute("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    if(orgCreated)await setup.execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([setup.end(),publisher.end(),changer.end()]);
  }
});
