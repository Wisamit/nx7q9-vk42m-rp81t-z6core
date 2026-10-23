import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";

test("F8 §86 MariaDB: branch tax revision and active service remain atomic under concurrent retirement",{
  timeout:45000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)};
  const [writer,retirer]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branchA=randomUUID(),
    branchB=randomUUID(),foreignBranch=randomUUID(),testId=randomUUID();
  const code="FTXA"+org.slice(0,8);
  const inserted:Array<{table:string;id:string}>=[];
  async function put(table:string,id:string,sql:string,args:(string|null)[]){
    await writer.execute(sql,args);inserted.unshift({table,id});
  }
  try{
    for(const [id,suffix] of [[org,"O"],[foreignOrg,"F"]])
      await put("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,code+suffix,"Synthetic Tax Lock Lab"]);
    for(const [id,tenant,suffix] of [[branchA,org,"A"],[branchB,org,"B"],[foreignBranch,foreignOrg,"F"]])
      await put("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,code+suffix,"Synthetic Branch"]);
    await put("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,code+"T","Synthetic Tax Service"]);
    await retirer.query("SET SESSION innodb_lock_wait_timeout = 1");
    await writer.beginTransaction();
    const [orgLock]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(orgLock.length,1);
    const [active]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM branches WHERE organization_id=? AND status='ACTIVE'",[org]);
    assert.deepEqual(new Set(active.map(x=>x.id)),new Set([branchA,branchB]));
    const [increment]=await writer.execute<mysql.ResultSetHeader>(
      "UPDATE branches SET tax_config_version=tax_config_version+1 "+
      "WHERE organization_id=? AND status='ACTIVE'",[org]);
    assert.equal(increment.affectedRows,2,"every active same-tenant branch incremented");
    const [serviceLock]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=? "+
      "AND status='ACTIVE' FOR UPDATE",[testId,org]);
    assert.equal(serviceLock.length,1);
    await assert.rejects(async()=>
      retirer.execute("UPDATE lab_tests SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",
        [testId]),
      (e:unknown)=>Boolean(e&&typeof e==="object"&&"code" in e&&
        e.code==="ER_LOCK_WAIT_TIMEOUT"),"concurrent service retirement must wait for versioned publication");
    // Model a failed or aborted policy publication. Both versions and test
    // locks must roll back; a later writer cannot inherit a phantom approval.
    await writer.rollback();
    await retirer.execute("UPDATE lab_tests SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",
      [testId]);
    await writer.beginTransaction();
    const [inactive]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=? "+
      "AND status='ACTIVE' FOR UPDATE",[testId,org]);
    assert.equal(inactive.length,0,"retired service must fail close on retry");
    await writer.rollback();
    const [versionRows]=await retirer.execute<mysql.RowDataPacket[]>(
      "SELECT id,tax_config_version FROM branches WHERE id IN (?,?,?)",
      [branchA,branchB,foreignBranch]);
    assert.deepEqual(versionRows.map(x=>Number(x.tax_config_version)).sort(),
      [0,0,0],"aborted publication must not increment any tenant's tax revision");
    const source=readFileSync("src/lib/tax-publication-authority.ts","utf8");
    assert.ok(source.includes("FOR UPDATE"));
    assert.ok(source.includes("taxConfigVersion:{increment:1}"));
    assert.ok(source.includes("affected.count"));
  }finally{
    await Promise.all([writer.rollback().catch(()=>{}),retirer.rollback().catch(()=>{})]);
    for(const entry of inserted)
      await writer.execute("DELETE FROM "+entry.table+" WHERE id=?",[entry.id]).catch(()=>{});
    await Promise.all([writer.end(),retirer.end()]);
  }
});
