import test from "node:test";
import assert from "node:assert/strict";
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "../src/lib/catalog-clinical-import-scope.ts";
import { reconcileComponentCandidate } from "../src/lib/component-import-reconciliation.ts";

test("MariaDB: component reconciliation resolves only an active test in the granted branch/department", { timeout: 30000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const options={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(options),mysql.createConnection(options)]);
  const org=randomUUID(),other=randomUUID(),a=randomUUID(),b=randomUUID(),aDept=randomUUID(),bDept=randomUUID(),otherDept=randomUUID();
  const testA=randomUUID(),testB=randomUUID(),testOther=randomUUID(),suffix=org.slice(0,8);
  const ins=(sql:string,params: (string|null)[])=>writer.execute(sql,params);
  try {
    for (const [id,label] of [[org,"O"],[other,"X"]])
      await ins("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",[id,"C33"+suffix+label,"Component Organization"]);
    for(const [id,tenant,label] of [[a,org,"A"],[b,org,"B"]])
      await ins("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",[id,tenant,"C33"+suffix+label,"Branch"]);
    for(const [id,tenant,branch,label] of [[aDept,org,a,"A"],[bDept,org,b,"B"],[otherDept,other,null,"X"]])
      await ins("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",[id,tenant,branch,"C33"+suffix+"D"+label,"Department"]);
    for(const [id,tenant,department,label] of [[testA,org,aDept,"A"],[testB,org,bDept,"B"],[testOther,other,otherDept,"X"]])
      await ins("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",[id,tenant,department,"C33"+suffix+"T"+label,"Test"]);
    const scope=resolveClinicalImportScope({organizationId:org,activeBranchId:a,activeBranch:{id:a,organizationId:org,status:"ACTIVE"},
      branchScopes:[{branchId:a,branch:{status:"ACTIVE"}}],departmentScopes:[{departmentId:aDept,department:{organizationId:org,branchId:a,status:"ACTIVE"}}]});
    assert.ok(scope);
    const where=clinicalImportTestWhere(scope);
    assert.deepEqual(where.departmentId,{in:[aDept]});
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT t.id,t.code FROM lab_tests t JOIN departments d ON d.id=t.department_id WHERE t.organization_id=? AND t.status='ACTIVE' AND d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?) AND t.department_id IN (?)",
      [where.organizationId as string,a,aDept]);
    assert.equal(rows.length,1);
    assert.equal(rows[0].id,testA);
    const indexes={tests:new Map(rows.map(r=>[String(r.code).toUpperCase(),{id:String(r.id),status:"ACTIVE"}])),
      units:new Map<string,{id:string;status:string}>(),components:new Set<string>()};
    const permitted=reconcileComponentCandidate({testCode:("C33"+suffix+"TA").toUpperCase(),code:"HGB",nameEn:"Hemoglobin",unitCode:"",resultType:"NUMERIC"},indexes,1);
    assert.equal(permitted.disposition,"READY_FOR_GOVERNANCE");
    const denied=reconcileComponentCandidate({testCode:("C33"+suffix+"TB").toUpperCase(),code:"HGB",nameEn:"Hemoglobin",unitCode:"",resultType:"NUMERIC"},indexes,1);
    assert.equal(denied.disposition,"BLOCKED");
    assert.equal(denied.resolvedTestId,null);
    assert.ok(denied.issues.includes("PARENT_TEST_NOT_ACTIVE_OR_MISSING"));
    assert.ok(![...indexes.tests.values()].some(t=>t.id===testOther));
  } finally {
    await ins("DELETE FROM lab_tests WHERE id IN (?,?,?)",[testA,testB,testOther]).catch(()=>{});
    await ins("DELETE FROM departments WHERE id IN (?,?,?)",[aDept,bDept,otherDept]).catch(()=>{});
    await ins("DELETE FROM branches WHERE id IN (?,?)",[a,b]).catch(()=>{});
    await ins("DELETE FROM organizations WHERE id IN (?,?)",[org,other]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
