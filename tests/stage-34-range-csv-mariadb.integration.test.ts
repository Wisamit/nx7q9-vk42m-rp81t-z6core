import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { reconcileRangeReviewCandidate } from "../src/lib/catalog-range-import-reconciliation.ts";

test("MariaDB: scoped CSV range preview excludes another tenant and another branch", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const connection = { host: url.hostname, port: Number(url.port || 3306), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: url.pathname.slice(1) };
  const [writer,reader] = await Promise.all([mysql.createConnection(connection),mysql.createConnection(connection)]);
  const org=randomUUID(),foreign=randomUUID(),branchA=randomUUID(),branchB=randomUUID();
  const deptA=randomUUID(),deptB=randomUUID(),unitId=randomUUID(),testA=randomUUID(),testB=randomUUID(),componentId=randomUUID();
  const prefix=org.slice(0,8);
  const run=(sql:string,params: Array<string | null>)=>writer.execute(sql,params);
  try {
    for(const [id,code] of [[org,"OWN"],[foreign,"OTHER"]]) {
      await run("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,"ST34-"+prefix+code,"Range Scope Org"]);
    }
    for(const [id,owner,code] of [[branchA,org,"A"],[branchB,org,"B"]]) {
      await run("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,owner,"ST34-"+prefix+code,"Branch"]);
    }
    for(const [id,branch,code] of [[deptA,branchA,"DA"],[deptB,branchB,"DB"]]) {
      await run("INSERT INTO departments (id,organization_id,branch_id,code,name_en,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [id,org,branch,"ST34-"+prefix+code,"Department"]);
    }
    await run("INSERT INTO units (id,organization_id,code,symbol,name_en,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [unitId,org,"ST34-"+prefix+"U","g/dL","Unit"]);
    for(const [id,department,code] of [[testA,deptA,"A"],[testB,deptB,"B"]]){
      await run("INSERT INTO lab_tests (id,organization_id,department_id,default_unit_id,code,name_en,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
        [id,org,department,unitId,"ST34-"+prefix+code,"Hemoglobin"]);
    }
    await run("INSERT INTO test_components (id,test_id,code,name_en,unit_id,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [componentId,testA,"HGB","Hemoglobin",unitId]);
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      `SELECT t.id,t.code,t.name_en AS nameEn,t.status,t.default_unit_id AS defaultUnitId
       FROM lab_tests t JOIN departments d ON d.id=t.department_id
       WHERE t.organization_id=? AND t.status='ACTIVE'
        AND (d.branch_id IS NULL OR d.branch_id=?) AND d.status='ACTIVE'
        AND t.department_id IN (?)`,[org,branchA,deptA]);
    assert.deepEqual(rows.map(r=>r.id),[testA]);
    const candidates=rows.map(r=>({id:String(r.id),code:String(r.code),nameEn:String(r.nameEn),
      status:String(r.status),defaultUnitId:r.defaultUnitId as string|null,
      components:[{id:componentId,unitId,status:"ACTIVE"}]}));
    const review=reconcileRangeReviewCandidate({
      testName:"Hemoglobin",unit:"g/dL",sex:"ANY",ageFrom:"",ageTo:"",ageUnit:"",
      low:"12.500000",high:"16.000000",normalTextEn:"",
    },candidates,[{id:unitId,code:"GDL",symbol:"g/dL",status:"ACTIVE"}]);
    assert.equal(review.disposition,"REVIEW_REQUIRED");
    assert.equal(review.testId,testA);
    const [foreignRows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE organization_id=? AND id IN (?,?)",[foreign,testA,testB]);
    assert.equal(foreignRows.length,0);
    const outOfScope=reconcileRangeReviewCandidate({
      testName:"Hemoglobin",unit:"g/dL",sex:"ANY",ageFrom:"",ageTo:"",ageUnit:"",
      low:"12.5",high:"16",normalTextEn:"",
    },[],[{id:unitId,code:"GDL",symbol:"g/dL",status:"ACTIVE"}]);
    assert.equal(outOfScope.disposition,"BLOCKED");
    assert.equal(outOfScope.testId,null);
  } finally {
    await run("DELETE FROM test_components WHERE id=?",[componentId]).catch(()=>{});
    await run("DELETE FROM lab_tests WHERE id IN (?,?)",[testA,testB]).catch(()=>{});
    await run("DELETE FROM units WHERE id=?",[unitId]).catch(()=>{});
    await run("DELETE FROM departments WHERE id IN (?,?)",[deptA,deptB]).catch(()=>{});
    await run("DELETE FROM branches WHERE id IN (?,?)",[branchA,branchB]).catch(()=>{});
    await run("DELETE FROM organizations WHERE id IN (?,?)",[org,foreign]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
