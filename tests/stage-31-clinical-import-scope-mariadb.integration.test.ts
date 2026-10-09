import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  permittedClinicalImportTest, resolveClinicalImportScope,
} from "../src/lib/catalog-clinical-import-scope.ts";

test("MariaDB two connections: clinical catalog imports stay in active branch/department and tenant", { timeout: 45000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(), foreign=randomUUID(), branchA=randomUUID(),branchB=randomUUID(),foreignBranch=randomUUID();
  const deptA=randomUUID(),deptB=randomUUID(),deptGlobal=randomUUID(),foreignDept=randomUUID();
  const testA=randomUUID(),testB=randomUUID(),testGlobal=randomUUID(),testForeign=randomUUID();
  const suffix=org.slice(0,8),prefix="CI31-"+suffix;
  const insert=async(sql:string,args: Array<string | number | null>)=>writer.execute(sql,args);
  try {
    for(const [id,key] of [[org,"OWN"],[foreign,"FOREIGN"]]) {
      await insert("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,prefix+key,"Clinical Import Tenant"]);
    }
    for(const [id,tenant,key] of [[branchA,org,"A"],[branchB,org,"B"],[foreignBranch,foreign,"F"]]) {
      await insert("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,tenant,prefix+key,"Clinical Branch"]);
    }
    for(const [id,tenant,branch,key] of [
      [deptA,org,branchA,"DA"],[deptB,org,branchB,"DB"],
      [deptGlobal,org,null,"GLOBAL"],[foreignDept,foreign,foreignBranch,"DF"],
    ]) {
      await insert("INSERT INTO departments (id,organization_id,branch_id,code,name_en,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [id,tenant,branch,prefix+key,"Clinical Department"]);
    }
    for(const [id,tenant,department,key] of [
      [testA,org,deptA,"TA"],[testB,org,deptB,"TB"],
      [testGlobal,org,deptGlobal,"TG"],[testForeign,foreign,foreignDept,"TF"],
    ]) {
      await insert("INSERT INTO lab_tests (id,organization_id,department_id,code,name_en,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [id,tenant,department,prefix+key,"Lab Test"]);
    }
    const scopes = {
      organizationId:org,activeBranchId:branchA,
      activeBranch:{id:branchA,organizationId:org,status:"ACTIVE"},
      branchScopes:[{branchId:branchA,branch:{status:"ACTIVE"}}],
      departmentScopes:[{departmentId:deptA,department:{status:"ACTIVE",organizationId:org,branchId:branchA}},
        {departmentId:deptGlobal,department:{status:"ACTIVE",organizationId:org,branchId:null}}],
    };
    const scope=resolveClinicalImportScope(scopes);
    assert.ok(scope);
    const sql=`SELECT t.id,t.department_id,d.branch_id,d.status AS department_status
      FROM lab_tests t JOIN departments d ON d.id=t.department_id
      WHERE t.organization_id=? AND t.status='ACTIVE' AND d.status='ACTIVE'
        AND (d.branch_id IS NULL OR d.branch_id=?)
        AND t.department_id IN (?,?) ORDER BY t.id`;
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(sql,[org,branchA,deptA,deptGlobal]);
    assert.equal(rows.length,2);
    const ids=new Set(rows.map(r=>String(r.id)));
    assert.ok(ids.has(testA));
    assert.ok(ids.has(testGlobal));
    assert.ok(!ids.has(testB));
    assert.ok(!ids.has(testForeign));
    assert.ok(rows.every(r=>permittedClinicalImportTest({
      departmentId:String(r.department_id),
      department:{branchId:r.branch_id as string|null,status:String(r.department_status)},
    },scope)));

    const [foreignAttempt]=await reader.execute<mysql.RowDataPacket[]>(sql,[foreign,branchA,deptA,deptGlobal]);
    assert.equal(foreignAttempt.length,0);
    const [branchBAttempt]=await reader.execute<mysql.RowDataPacket[]>(sql,[org,branchB,deptA,deptGlobal]);
    assert.equal(branchBAttempt.length,1,"out-of-branch department must still be excluded by grant list");
    assert.equal(String(branchBAttempt[0].id),testGlobal);
    const bad=resolveClinicalImportScope({...scopes,activeBranchId:branchB,activeBranch:{
      id:branchB,organizationId:org,status:"ACTIVE",
    }});
    assert.equal(bad,null,"branch switch without an active user grant must fail closed");
  } finally {
    await insert("DELETE FROM lab_tests WHERE id IN (?,?,?,?)",[testA,testB,testGlobal,testForeign]).catch(()=>{});
    await insert("DELETE FROM departments WHERE id IN (?,?,?,?)",[deptA,deptB,deptGlobal,foreignDept]).catch(()=>{});
    await insert("DELETE FROM branches WHERE id IN (?,?,?)",[branchA,branchB,foreignBranch]).catch(()=>{});
    await insert("DELETE FROM organizations WHERE id IN (?,?)",[org,foreign]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
