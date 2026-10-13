import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 102 MariaDB: branch hierarchy isolation, schedule uniqueness and locked updates", {timeout:75_000}, async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const db=await mysql.createConnection(cfg), db2=await mysql.createConnection(cfg);
  const org=randomUUID(), org2=randomUUID(), branch=randomUUID(), foreignBranch=randomUUID(),
    dept=randomUUID(), globalDept=randomUUID(), station=randomUUID(), settings=randomUUID();
  const key=org.slice(0,8);
  const rows:Array<{table:string;id:string}>=[];
  async function put(table:string,id:string,sql:string,params:(string|number)[]){
    await db.execute(sql,params); rows.unshift({table,id});
  }
  try{
    await put("organizations",org,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"S102"+key+"A","Stage102 Organization"]);
    await put("organizations",org2,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org2,"S102"+key+"B","Stage102 Other Organization"]);
    await put("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,timezone,default_currency,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [branch,org,"S102A"+key,"Stage102 Main","Asia/Dubai","AED"]);
    await put("branches",foreignBranch,
      "INSERT INTO branches(id,organization_id,code,name_en,timezone,default_currency,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [foreignBranch,org2,"S102B"+key,"Other Tenant","Asia/Dubai","AED"]);
    await put("departments",dept,
      "INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [dept,org,branch,"S102D"+key,"Biochemistry"]);
    await put("departments",globalDept,
      "INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [globalDept,org,null as unknown as string,"S102G"+key,"Shared Department"]);
    await put("workstations",station,
      "INSERT INTO workstations(id,branch_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [station,branch,dept,"S102W"+key,"Station 1"]);
    const workingHours=JSON.stringify({version:1,days:{mon:[{open:"08:00",close:"17:00"}],
      tue:[],wed:[],thu:[],fri:[],sat:[],sun:[]}});
    await put("branch_settings",settings,
      "INSERT INTO branch_settings(id,branch_id,\`key\`,value,updated_at) VALUES(?,?,?,?,NOW(3))",
      [settings,branch,"working_hours_v1",workingHours]);
    const [ours]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT w.id FROM workstations w INNER JOIN branches b ON b.id=w.branch_id WHERE b.organization_id=? AND w.branch_id=?",
      [org,branch]);
    const [wrongBranch]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT w.id FROM workstations w INNER JOIN branches b ON b.id=w.branch_id WHERE b.organization_id=? AND w.branch_id=?",
      [org,foreignBranch]);
    const [wrongOrg]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT w.id FROM workstations w INNER JOIN branches b ON b.id=w.branch_id WHERE b.organization_id=? AND w.branch_id=?",
      [org2,branch]);
    assert.equal(ours.length,1);assert.equal(wrongBranch.length,0);assert.equal(wrongOrg.length,0);
    const [validDept]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM departments WHERE organization_id=? AND status='ACTIVE' AND (branch_id IS NULL OR branch_id=?)",
      [org,branch]);
    const [crossTenantDept]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM departments WHERE organization_id=? AND status='ACTIVE' AND (branch_id IS NULL OR branch_id=?)",
      [org2,branch]);
    assert.equal(validDept.length,2);assert.equal(crossTenantDept.length,0);
    await assert.rejects(
      ()=>db.execute(
        "INSERT INTO branch_settings(id,branch_id,\`key\`,value,updated_at) VALUES(?,?,?,?,NOW(3))",
        [randomUUID(),branch,"working_hours_v1",workingHours]),/Duplicate entry/i,
    );
    const [settingsRows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT value FROM branch_settings WHERE branch_id=? AND \`key\`='working_hours_v1'",[branch]);
    assert.equal(settingsRows.length,1);
    const parsedHours=typeof settingsRows[0].value==="string"?JSON.parse(settingsRows[0].value):settingsRows[0].value;
    assert.equal(parsedHours.days.mon[0].open,"08:00");
    await db.beginTransaction();
    await db.execute("SELECT id FROM branches WHERE id=? FOR UPDATE",[branch]);
    await db2.execute("SET SESSION innodb_lock_wait_timeout = 1");
    await assert.rejects(()=>db2.execute("UPDATE branches SET name_en=? WHERE id=?",["Concurrent takeover",branch]),
      e=>(e as {code?:string}).code==="ER_LOCK_WAIT_TIMEOUT");
    await db.rollback();
    const [unchanged]=await db.execute<mysql.RowDataPacket[]>("SELECT name_en FROM branches WHERE id=?",[branch]);
    assert.equal(unchanged[0].name_en,"Stage102 Main");
    const [closureBlocker]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM workstations WHERE branch_id=? AND status='ACTIVE'",[branch]);
    assert.equal(Number(closureBlocker[0].total),1);
  }finally{
    await db.rollback().catch(()=>{});
    for(const {table,id} of rows) await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
    await db2.end();await db.end();
  }
});
