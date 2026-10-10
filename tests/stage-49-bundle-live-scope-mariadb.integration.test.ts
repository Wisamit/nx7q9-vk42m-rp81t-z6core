import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {BUNDLE_REVIEW_SOURCE} from "../src/lib/catalog-bundle-review.ts";

test("Stage 49 MariaDB two sessions: revoked grants before review commit cannot stage even a source-only batch",
{timeout:45000},async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [first,second]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),foreignBranch=randomUUID(),
    department=randomUUID(),foreignDepartment=randomUUID(),testId=randomUUID(),
    foreignTestId=randomUUID(),actor=randomUUID(),batch=randomUUID(),row=randomUUID();
  const code="S49"+org.slice(0,8);
  const exec=(sql:string,params:(string|number|null)[])=>first.execute(sql,params);
  try {
    for(const [id,suffix] of [[org,"A"],[foreignOrg,"B"]]){
      await exec("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,code+suffix,"Stage 49 Organization"]);
    }
    for(const [id,organization,suffix] of [[branch,org,"A"],[foreignBranch,foreignOrg,"B"]]){
      await exec("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,organization,code+suffix,"Stage 49 Branch"]);
    }
    for(const [id,organization,branchId,suffix] of [
      [department,org,branch,"A"],[foreignDepartment,foreignOrg,foreignBranch,"B"]]){
      await exec("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,organization,branchId,code+suffix,"Stage 49 Department"]);
    }
    for(const [id,organization,departmentId,suffix] of [
      [testId,org,department,"A"],[foreignTestId,foreignOrg,foreignDepartment,"B"]]){
      await exec("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,organization,departmentId,code+suffix,"Stage 49 Test"]);
    }
    await exec("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor,org,code,"Stage 49 Reviewer"]);
    await exec("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[actor,branch]);
    await exec("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",[actor,department]);

    await first.beginTransaction();
    const [locked]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(locked.length,1);
    await second.execute("SET SESSION innodb_lock_wait_timeout=6");
    await second.beginTransaction();
    const queued=second.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);

    // Revocation is committed before the competing request is allowed past the tenant lock.
    await first.execute("DELETE FROM user_department_scopes WHERE user_id=? AND department_id=?",
      [actor,department]);
    await first.execute("DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",
      [actor,branch]);
    await first.commit();
    const [acquired]=await queued;
    assert.equal(acquired.length,1);
    const [revokedBranches]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT u.branch_id FROM user_branch_scopes u JOIN branches b ON b.id=u.branch_id WHERE u.user_id=? AND b.organization_id=? AND b.status='ACTIVE'",
      [actor,org]);
    const [revokedDepartments]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT department_id FROM user_department_scopes WHERE user_id=?",[actor]);
    assert.equal(revokedBranches.length,0);
    assert.equal(revokedDepartments.length,0);
    // No snapshot is staged after live revocation; unrelated tenant masters remain inaccessible.
    const [offTenant]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=?",[foreignTestId,org]);
    assert.equal(offTenant.length,0);
    await second.commit();
    const [emptyBatches]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM catalog_import_batches WHERE organization_id=? AND source_type=?",[org,BUNDLE_REVIEW_SOURCE]);
    assert.equal(emptyBatches.length,0);

    // Restored grants are needed for the existing source-only DRAFT review flow.
    await exec("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[actor,branch]);
    await exec("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",[actor,department]);
    await second.beginTransaction();
    const [relocked]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]);
    assert.equal(relocked.length,1);
    const [authorized]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT t.id FROM lab_tests t JOIN departments d ON d.id=t.department_id JOIN user_department_scopes ds ON ds.department_id=d.id JOIN user_branch_scopes bs ON bs.branch_id=d.branch_id WHERE t.id=? AND t.organization_id=? AND ds.user_id=? AND bs.user_id=?",
      [testId,org,actor,actor]);
    assert.deepEqual(authorized.map(x=>String(x.id)),[testId]);
    await second.execute(
      "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,summary,updated_at) VALUES(?,?,?,'s49.json','DRAFT',?,?,NOW(3))",
      [batch,org,BUNDLE_REVIEW_SOURCE,actor,JSON.stringify({reviewOnly:true,total:1})]);
    await second.execute(
      "INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,legacy_key,source_data,normalized_data,validation_issues,updated_at) VALUES(?,?,1,'TEST','WARNING',?,?,?,?,NOW(3))",
      [row,batch,testId,JSON.stringify({id:testId,code:code+"A"}),
        JSON.stringify({id:testId,code:code+"A"}),JSON.stringify([{severity:"WARNING",code:"CONFIGURATION_BUNDLE_REVIEW_ONLY"}])]);
    await second.commit();
    const [staged]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT status,imported_entity_id FROM catalog_import_rows WHERE id=?",[row]);
    assert.equal(staged.length,1);
    assert.equal(staged[0].status,"WARNING");
    assert.equal(staged[0].imported_entity_id,null);
    const [unchanged]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT code,status FROM lab_tests WHERE id=?",[testId]);
    assert.equal(unchanged[0].code,code+"A");
    assert.equal(unchanged[0].status,"ACTIVE");
  }finally{
    await first.rollback().catch(()=>{});
    await second.rollback().catch(()=>{});
    await exec("DELETE FROM catalog_import_rows WHERE id=?",[row]).catch(()=>{});
    await exec("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await exec("DELETE FROM user_department_scopes WHERE user_id=?",[actor]).catch(()=>{});
    await exec("DELETE FROM user_branch_scopes WHERE user_id=?",[actor]).catch(()=>{});
    await exec("DELETE FROM lab_tests WHERE id IN (?,?)",[testId,foreignTestId]).catch(()=>{});
    await exec("DELETE FROM departments WHERE id IN (?,?)",[department,foreignDepartment]).catch(()=>{});
    await exec("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
    await exec("DELETE FROM branches WHERE id IN (?,?)",[branch,foreignBranch]).catch(()=>{});
    await exec("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    await Promise.all([first.end(),second.end()]);
  }
});
