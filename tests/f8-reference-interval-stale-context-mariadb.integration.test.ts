import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

const uuid = () => randomUUID();
const prefix = (name:string,id:string) => name+id.slice(0,8).toUpperCase();

/**
 * Real two-session MariaDB proof for DRAFT -> APPROVE clinical context:
 * deactivation before approval must block; deactivation after FOR UPDATE
 * must wait. Tests use only synthetic tenant/branch/instrument identifiers.
 */
test("F8 §75/87 MariaDB: inactive method, specimen or analyzer cannot be approved from stale DRAFT",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const cfg={
    host:uri.hostname,port:Number(uri.port||3306),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
    database:uri.pathname.slice(1),timezone:"Z",
  };
  const [setup,reviewer,changer]=await Promise.all([
    mysql.createConnection(cfg),mysql.createConnection(cfg),mysql.createConnection(cfg),
  ]);
  const org=uuid(),branch=uuid(),testId=uuid(),component=uuid(),
    method=uuid(),specimen=uuid(),analyzer=uuid(),draft=uuid();
  const inserted:string[]=[];
  async function add(table:string,sql:string,args:string[]){
    await setup.execute(sql,args);inserted.unshift(table);
  }
  try{
    await add("organizations",
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,prefix("R8O",org),"Synthetic Context Organization"]);
    await add("branches",
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,prefix("R8B",branch),"Synthetic Context Branch"]);
    await add("lab_tests",
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,prefix("R8T",testId),"Synthetic Test"]);
    await add("test_components",
      "INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [component,testId,prefix("R8C",component),"Synthetic Component"]);
    await add("methods",
      "INSERT INTO methods(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [method,org,prefix("R8M",method),"Synthetic Method"]);
    await add("specimen_types",
      "INSERT INTO specimen_types(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [specimen,org,prefix("R8S",specimen),"Synthetic Specimen"]);
    await add("analyzers",
      "INSERT INTO analyzers(id,organization_id,branch_id,code,name,protocol,transport,updated_at) "+
        "VALUES(?,?,?,?,?,'HL7_V2','TCP_CLIENT',NOW(3))",
      [analyzer,org,branch,prefix("R8A",analyzer),"Synthetic Analyzer"]);
    await add("reference_intervals",
      "INSERT INTO reference_intervals(id,component_id,branch_id,method_id,analyzer_id,specimen_type_id,"+
      "effective_from,status,approval_status,updated_at) VALUES(?,?,?,?,?,?,'2026-10-24 00:00:00.000','INACTIVE','DRAFT',NOW(3))",
      [draft,component,branch,method,analyzer,specimen]);
    const contexts=[
      {table:"methods",id:method},
      {table:"specimen_types",id:specimen},
      {table:"analyzers",id:analyzer},
    ] as const;
    for(const inactive of contexts){
      await changer.execute("UPDATE "+inactive.table+" SET status='INACTIVE' WHERE id=?",[inactive.id]);
      await reviewer.beginTransaction();
      const [tenant]=await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
      assert.equal(tenant.length,1);
      const [locked]=await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM reference_intervals WHERE id=? FOR UPDATE",[draft]);
      assert.equal(locked.length,1);
      const [methodRows]=await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM methods WHERE id=? AND organization_id=? AND status='ACTIVE' FOR UPDATE",
        [method,org]);
      const [specimenRows]=await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM specimen_types WHERE id=? AND organization_id=? AND status='ACTIVE' FOR UPDATE",
        [specimen,org]);
      const [analyzerRows]=await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT id,branch_id FROM analyzers WHERE id=? AND organization_id=? AND status='ACTIVE' FOR UPDATE",
        [analyzer,org]);
      assert.ok([methodRows,specimenRows,analyzerRows].some(rows=>rows.length===0),
        "all clinical context masters must still exist and be active at approval");
      await reviewer.rollback();
      const [still]=await setup.execute<mysql.RowDataPacket[]>(
        "SELECT approval_status,status FROM reference_intervals WHERE id=?",[draft]);
      assert.equal(still[0].approval_status,"DRAFT");
      assert.equal(still[0].status,"INACTIVE");
      await changer.execute("UPDATE "+inactive.table+" SET status='ACTIVE' WHERE id=?",[inactive.id]);
    }

    // The same locking read stops a second session from deactivating
    // a previously verified method while the approval decision is underway.
    await changer.query("SET SESSION innodb_lock_wait_timeout=1");
    await reviewer.beginTransaction();
    const [locked]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM methods WHERE id=? AND organization_id=? AND status='ACTIVE' FOR UPDATE",
      [method,org]);
    assert.equal(locked.length,1);
    await changer.beginTransaction();
    await assert.rejects(
      async()=>changer.execute("UPDATE methods SET status='INACTIVE' WHERE id=?",[method]),
      (error:unknown)=>Boolean(error && typeof error==="object" &&
        "code" in error && error.code==="ER_LOCK_WAIT_TIMEOUT"),
    );
    await changer.rollback();
    await reviewer.rollback();
    const [check]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM methods WHERE id=?",[method]);
    assert.equal(check[0].status,"ACTIVE");
    const [audit]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM audit_events WHERE organization_id=? AND action='REFERENCE_INTERVAL_APPROVED'",
      [org]);
    assert.equal(Number(audit[0].count),0,"no approval evidence is forged by a rejected DRAFT");
  }finally{
    await Promise.all([reviewer.rollback().catch(()=>{}),changer.rollback().catch(()=>{})]);
    const deletes:{table:string;id:string}[]=[
      {table:"reference_intervals",id:draft},
      {table:"analyzers",id:analyzer},
      {table:"specimen_types",id:specimen},
      {table:"methods",id:method},
      {table:"test_components",id:component},
      {table:"lab_tests",id:testId},
      {table:"branches",id:branch},
      {table:"organizations",id:org},
    ];
    for(const entry of deletes)
      if(inserted.includes(entry.table))
        await setup.execute("DELETE FROM "+entry.table+" WHERE id=?",[entry.id]).catch(()=>{});
    await Promise.all([setup.end(),reviewer.end(),changer.end()]);
  }
});
