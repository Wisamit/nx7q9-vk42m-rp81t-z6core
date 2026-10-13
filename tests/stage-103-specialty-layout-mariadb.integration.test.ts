import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 103 MariaDB: scoped component sections, atomic batch rollback and conflict fencing",
  {timeout:75_000},async()=>{
    if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
    const url=new URL(process.env.DATABASE_URL);
    const config={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
      password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
    const a=await mysql.createConnection(config),b=await mysql.createConnection(config);
    const org=randomUUID(),otherOrg=randomUUID(),testId=randomUUID(),foreignTest=randomUUID(),
      sectionId=randomUUID(),componentId=randomUUID(),foreignComponent=randomUUID();
    const key=org.slice(0,8);
    const rows:Array<{table:string;id:string}>=[];
    async function add(table:string,id:string,sql:string,params:Array<string|null>){
      await a.execute(sql,params);rows.unshift({table,id});
    }
    try{
      await add("organizations",org,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [org,"S103A"+key,"Test tenant"]);
      await add("organizations",otherOrg,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [otherOrg,"S103B"+key,"Other tenant"]);
      await add("lab_tests",testId,
        "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [testId,org,"S103T"+key,"Specialty test"]);
      await add("lab_tests",foreignTest,
        "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [foreignTest,otherOrg,"S103F"+key,"Other specialty test"]);
      await add("test_result_sections",sectionId,
        "INSERT INTO test_result_sections(id,test_id,code,name_en,display_order,column_count,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
        [sectionId,testId,"PART_A","Original A","0","2"]);
      await add("test_components",componentId,
        "INSERT INTO test_components(id,test_id,code,name_en,result_section_id,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [componentId,testId,"SPEC_A","Same tenant",sectionId]);
      await add("test_components",foreignComponent,
        "INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [foreignComponent,foreignTest,"FOREIGN","Wrong tenant"]);
      const [own]=await a.execute<mysql.RowDataPacket[]>(
        "SELECT c.id FROM test_components c INNER JOIN lab_tests t ON t.id=c.test_id WHERE t.organization_id=? AND t.id=?",
        [org,testId]);
      const [foreign]=await a.execute<mysql.RowDataPacket[]>(
        "SELECT c.id FROM test_components c INNER JOIN lab_tests t ON t.id=c.test_id WHERE t.organization_id=? AND t.id=?",
        [org,foreignTest]);
      assert.equal(own.length,1);assert.equal(foreign.length,0);
      // All mutations and final audit belong inside the same transaction.
      await a.beginTransaction();
      await a.execute("SELECT id FROM lab_tests WHERE id=? FOR UPDATE",[testId]);
      await a.execute("SELECT id FROM test_result_sections WHERE test_id=? FOR UPDATE",[testId]);
      await a.execute("SELECT id FROM test_components WHERE test_id=? FOR UPDATE",[testId]);
      await a.execute("UPDATE test_result_sections SET name_en=? WHERE id=?",["Uncommitted",sectionId]);
      await a.execute("UPDATE test_components SET entry_width='WIDE' WHERE id=?",[componentId]);
      const [uncommitted]=await a.execute<mysql.RowDataPacket[]>(
        "SELECT entry_width FROM test_components WHERE id=?",[componentId]);
      assert.equal(uncommitted[0].entry_width,"WIDE");
      await a.rollback();
      const [sectionAfterRollback]=await b.execute<mysql.RowDataPacket[]>(
        "SELECT name_en FROM test_result_sections WHERE id=?",[sectionId]);
      const [componentAfterRollback]=await b.execute<mysql.RowDataPacket[]>(
        "SELECT entry_width FROM test_components WHERE id=?",[componentId]);
      assert.equal(sectionAfterRollback[0].name_en,"Original A");
      assert.equal(componentAfterRollback[0].entry_width,"AUTO");
      await a.beginTransaction();
      await a.execute("SELECT id FROM lab_tests WHERE id=? FOR UPDATE",[testId]);
      await a.execute("SELECT id FROM test_result_sections WHERE test_id=? FOR UPDATE",[testId]);
      await a.execute("SELECT id FROM test_components WHERE test_id=? FOR UPDATE",[testId]);
      await b.execute("SET SESSION innodb_lock_wait_timeout = 1");
      await assert.rejects(()=>b.execute("UPDATE test_components SET entry_width='FULL' WHERE id=?",[componentId]),
        e=>(e as {code?:string}).code==="ER_LOCK_WAIT_TIMEOUT");
      await a.rollback();
      const [stillUnchanged]=await a.execute<mysql.RowDataPacket[]>(
        "SELECT entry_width FROM test_components WHERE id=?",[componentId]);
      assert.equal(stillUnchanged[0].entry_width,"AUTO");
    }finally{
      await a.rollback().catch(()=>{});
      for(const {table,id} of rows) await a.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
      await b.end();await a.end();
    }
  });
