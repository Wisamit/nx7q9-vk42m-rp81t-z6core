import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { reconcileComponentCandidate } from "../src/lib/component-import-reconciliation.ts";

test("MariaDB staged components: tenant-scoped parent/unit lookup, duplicate identities and existing component collision", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const uri = new URL(process.env.DATABASE_URL);
  const cfg = { host: uri.hostname, port: Number(uri.port || 3306),
    user: decodeURIComponent(uri.username), password: decodeURIComponent(uri.password),
    database: uri.pathname.slice(1) };
  const [writer, reader] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), other = randomUUID();
  const actor = randomUUID(), otherActor = randomUUID(), testId = randomUUID(), otherTest = randomUUID();
  const unit = randomUUID(), otherUnit = randomUUID(), existingComponent = randomUUID();
  const batch = randomUUID(), otherBatch = randomUUID(), suffix = org.slice(0, 8);
  const cleanup: Array<{ table: string; id: string }> = [];
  const staged: Array<{ id: string; n: number }> = [];
  const code = "C25-" + suffix;
  async function insert(sql: string, args: Array<string | number>, table: string, id: string) {
    await writer.execute(sql,args); cleanup.unshift({table,id});
  }
  try {
    for (const [id,k] of [[org,"A"],[other,"B"]]) {
      await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,code+k,"Catalog Reconciliation Tenant"],"organizations",id);
    }
    for (const [id,owner,k] of [[actor,org,"A"],[otherActor,other,"B"]]) {
      await insert("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,owner,"c25-"+k+suffix,"Component Author"],"users",id);
    }
    for (const [id,owner,k] of [[testId,org,"A"],[otherTest,other,"B"]]) {
      await insert("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,owner,"T-"+suffix,"Test "+k],"lab_tests",id);
    }
    for (const [id,owner,k] of [[unit,org,"A"],[otherUnit,other,"B"]]) {
      await insert("INSERT INTO units (id,organization_id,code,symbol,name_en,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [id,owner,"U-"+suffix,"mg","Unit "+k],"units",id);
    }
    await insert("INSERT INTO test_components (id,test_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [existingComponent,testId,"EXISTING","Existing Component"],"test_components",existingComponent);
    for (const [id,owner,user,k] of [[batch,org,actor,"A"],[otherBatch,other,otherActor,"B"]]) {
      await insert("INSERT INTO catalog_import_batches (id,organization_id,source_type,source_name,created_by_user_id,updated_at) VALUES (?,?,'JSON',?,?,NOW(3))",
        [id,owner,"Components "+k,user],"catalog_import_batches",id);
    }
    for (let n=1;n<=102;n++) {
      const id=randomUUID(), component=n<3?"DUP":n===3?"EXISTING":"NEW"+n;
      const normalized=JSON.stringify({testCode:"T-"+suffix,code:component,nameEn:"Analyte "+n,unitCode:"U-"+suffix,resultType:"NUMERIC"});
      await insert(
        "INSERT INTO catalog_import_rows (id,batch_id,`row_number`,entity_type,status,source_data,normalized_data) VALUES (?,?,?,'COMPONENT','WARNING',?,?)",
        [id,batch,n,normalized,normalized],"catalog_import_rows",id,
      ); staged.push({id,n});
    }
    const foreignRow=randomUUID();
    await insert(
      "INSERT INTO catalog_import_rows (id,batch_id,`row_number`,entity_type,status,source_data,normalized_data) VALUES (?,?,1,'COMPONENT','WARNING',?,?)",
      [foreignRow,otherBatch,JSON.stringify({testCode:"T-"+suffix,code:"PRIVATE"}),JSON.stringify({testCode:"T-"+suffix,code:"PRIVATE"})],
      "catalog_import_rows",foreignRow,
    );
    const load = async (after: number) => {
      const [rows]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,`row_number`,normalized_data FROM catalog_import_rows WHERE batch_id=? AND entity_type='COMPONENT' AND `row_number`>? ORDER BY `row_number` ASC,id ASC LIMIT 101",
        [batch,after],
      );
      return rows;
    };
    const first=await load(0), second=await load(100);
    assert.equal(first.length,101);
    assert.equal(second.length,2);
    assert.equal(new Set([...first.slice(0,100),...second].map(x=>x.id)).size,102);
    assert.ok(![...first,...second].some(x=>x.id===foreignRow));

    const [tests]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,status FROM lab_tests WHERE organization_id=? AND code=?",[org,"T-"+suffix]);
    const [units]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,status FROM units WHERE organization_id=? AND code=?",[org,"U-"+suffix]);
    const [components]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,code FROM test_components WHERE test_id=?",[testId]);
    const index = {
      tests: new Map(tests.map(x=>[String(x.code).toUpperCase(),{id:String(x.id),status:String(x.status)}])),
      units: new Map(units.map(x=>[String(x.code).toUpperCase(),{id:String(x.id),status:String(x.status)}])),
      components: new Set(components.map(x=>testId+"|"+String(x.code).toUpperCase())),
    };
    const check=(row: mysql.RowDataPacket,n: number) => {
      const data=typeof row.normalized_data==="string"?JSON.parse(row.normalized_data):row.normalized_data;
      return reconcileComponentCandidate(data,index,n);
    };
    assert.ok(check(first[0],2).issues.includes("DUPLICATE_COMPONENT_IN_BATCH"));
    assert.ok(check(first[2],1).issues.includes("COMPONENT_CODE_ALREADY_EXISTS"));
    assert.equal(check(first[3],1).disposition,"READY_FOR_GOVERNANCE");
    assert.equal(check(first[3],1).resolvedTestId,testId);
    assert.equal(check(first[3],1).resolvedUnitId,unit);
    assert.equal(reconcileComponentCandidate(
      {testCode:"NOT-IN-ORG",code:"X",nameEn:"Foreign",unitCode:"",resultType:"TEXT"},index,1
    ).disposition,"BLOCKED");
  } finally {
    for(const row of cleanup) await writer.execute(`DELETE FROM ${row.table} WHERE id=?`,[row.id]);
    await Promise.all([writer.end(),reader.end()]);
  }
});
