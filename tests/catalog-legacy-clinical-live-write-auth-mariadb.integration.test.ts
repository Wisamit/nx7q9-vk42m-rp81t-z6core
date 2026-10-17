import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { intersectLiveLegacyClinicalDepartments } from "../src/lib/catalog-legacy-clinical-write-auth.ts";

test("MariaDB clinical legacy write scope: current role, branch, department and target revocations", {
  timeout: 90000,
}, async () => {
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u = new URL(process.env.DATABASE_URL);
  const cfg = {host:u.hostname,port:Number(u.port||3306),database:u.pathname.slice(1),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password)};
  const [writer,observer] = await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),other=randomUUID(),branch=randomUUID(),branchB=randomUUID();
  const dept=randomUUID(),deptB=randomUUID(),user=randomUUID(),role=randomUUID();
  const testId=randomUUID(),testB=randomUUID(),batch=randomUUID(),key=org.slice(0,8);
  const undo:Array<{sql:string;args:string[]}>=[];

  async function seed(sql:string,args:string[],deleteSql:string,deleteArgs:string[]){
    await writer.execute(sql,args);undo.unshift({sql:deleteSql,args:deleteArgs});
  }
  async function liveActor():Promise<boolean>{
    const [rows]=await observer.execute<mysql.RowDataPacket[]>(
      "SELECT DISTINCT u.id FROM users u "+
      "JOIN organizations o ON o.id=u.organization_id AND o.status='ACTIVE' "+
      "JOIN user_roles ur ON ur.user_id=u.id "+
      "JOIN roles r ON r.id=ur.role_id AND r.organization_id=u.organization_id AND r.status='ACTIVE' "+
      "JOIN role_permissions rp ON rp.role_id=r.id "+
      "JOIN permissions p ON p.id=rp.permission_id AND p.code='catalog.reference_ranges.manage' "+
      "JOIN user_branch_scopes ub ON ub.user_id=u.id "+
      "JOIN branches b ON b.id=ub.branch_id AND b.organization_id=u.organization_id AND b.status='ACTIVE' "+
      "WHERE u.id=? AND u.organization_id=? AND u.status='ACTIVE' AND b.id=?",
      [user,org,branch]);
    return rows.length===1;
  }
  async function liveDeptIds():Promise<ReturnType<typeof readDeptRow>>{
    const [rows]=await observer.execute<mysql.RowDataPacket[]>(
      "SELECT uds.department_id,d.organization_id,d.branch_id,d.status "+
      "FROM user_department_scopes uds JOIN departments d ON d.id=uds.department_id "+
      "WHERE uds.user_id=?",[user]);
    return rows.map(x=>readDeptRow(x));
  }
  function readDeptRow(x:mysql.RowDataPacket) {
    return {departmentId:String(x.department_id),
      department:{organizationId:String(x.organization_id),
        branchId:x.branch_id as string|null,status:String(x.status)}};
  }
  try {
    for(const [id,tag] of [[org,"A"],[other,"F"]])await seed(
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,"LCW"+key+tag,"Synthetic Clinical Catalog Tenant"],
      "DELETE FROM organizations WHERE id=?",[id]);
    for(const [id,tag] of [[branch,"A"],[branchB,"B"]])await seed(
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id,org,"LCW"+key+tag,"Synthetic Clinical Branch"],
      "DELETE FROM branches WHERE id=?",[id]);
    for(const [id,branchId,tag] of [[dept,branch,"A"],[deptB,branchB,"B"]])await seed(
      "INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id,org,branchId,"LCW"+key+tag,"Synthetic Department"],
      "DELETE FROM departments WHERE id=?",[id]);
    await seed("INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
      [user,org,"lcw"+key,"Synthetic Clinical Reviewer"],
      "DELETE FROM users WHERE id=?",[user]);
    await seed("INSERT INTO roles(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [role,org,"LCW"+key,"Synthetic Range Role"],
      "DELETE FROM roles WHERE id=?",[role]);
    const [existing]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM permissions WHERE code='catalog.reference_ranges.manage' LIMIT 1");
    const permission=(existing[0]?.id as string|undefined)||randomUUID();
    if(!existing.length) await seed(
      "INSERT INTO permissions(id,code,module) VALUES(?,'catalog.reference_ranges.manage','catalog')",
      [permission],"DELETE FROM permissions WHERE id=?",[permission]);
    await seed("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)",
      [user,role],"DELETE FROM user_roles WHERE user_id=? AND role_id=?",[user,role]);
    await seed("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",
      [role,permission],"DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",[role,permission]);
    await seed("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",
      [user,branch],"DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[user,branch]);
    await seed("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",
      [user,dept],"DELETE FROM user_department_scopes WHERE user_id=? AND department_id=?",[user,dept]);
    for(const [id,department,tag] of [[testId,dept,"A"],[testB,deptB,"B"]])await seed(
      "INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id,org,department,"LCW"+key+tag,"Synthetic Clinical Test"],
      "DELETE FROM lab_tests WHERE id=?",[id]);
    await seed(
      "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) "+
      "VALUES(?,?,'LEGACY_MDB_EXPORT','synthetic.json','VALIDATED',?,NOW(3))",
      [batch,org,user],"DELETE FROM catalog_import_batches WHERE id=?",[batch]);

    assert.equal(await liveActor(),true);
    assert.deepEqual(intersectLiveLegacyClinicalDepartments(org,branch,[dept],await liveDeptIds()),[dept]);
    const [scope]=await observer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id IN (?,?) AND organization_id=? "+
      "AND department_id IN (?) AND status='ACTIVE'",[testId,testB,org,dept]);
    assert.deepEqual(scope.map(x=>x.id),[testId],"off-branch clinical targets excluded");

    await writer.beginTransaction();
    const [owned]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(owned.length,1);
    await observer.query("SET SESSION innodb_lock_wait_timeout=1");
    await observer.beginTransaction();
    await assert.rejects(observer.execute(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]),
      (err:unknown)=>Boolean(err&&typeof err==="object"&&"code" in err&&err.code==="ER_LOCK_WAIT_TIMEOUT"));
    await observer.rollback();
    await writer.commit();

    await writer.execute("DELETE FROM user_department_scopes WHERE user_id=? AND department_id=?",[user,dept]);
    assert.equal(intersectLiveLegacyClinicalDepartments(org,branch,[dept],await liveDeptIds()),null);
    const [batchRead]=await observer.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM catalog_import_batches WHERE id=?",[batch]);
    assert.equal(batchRead[0].status,"VALIDATED","revoked permission cannot claim legacy batch");
    await writer.execute("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",[user,deptB]);
    assert.equal(intersectLiveLegacyClinicalDepartments(org,branch,[dept],await liveDeptIds()),null,
      "new off-branch grant cannot widen stale session");
    await writer.execute("DELETE FROM user_department_scopes WHERE user_id=? AND department_id=?",[user,deptB]);
    await writer.execute("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",[user,dept]);

    await writer.execute("UPDATE roles SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[role]);
    assert.equal(await liveActor(),false);
    await writer.execute("UPDATE roles SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[role]);
    await writer.execute("DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",[role,permission]);
    assert.equal(await liveActor(),false);
    await writer.execute("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",[role,permission]);
    await writer.execute("DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[user,branch]);
    assert.equal(await liveActor(),false);
    await writer.execute("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[user,branch]);
    await writer.execute("UPDATE branches SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[branch]);
    assert.equal(await liveActor(),false);
    await writer.execute("UPDATE branches SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[branch]);
    await writer.execute("UPDATE users SET status='SUSPENDED',updated_at=NOW(3) WHERE id=?",[user]);
    assert.equal(await liveActor(),false);
    await writer.execute("UPDATE users SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[user]);
    await writer.execute("UPDATE organizations SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    assert.equal(await liveActor(),false);
    await writer.execute("UPDATE organizations SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    assert.equal(await liveActor(),true);
  } finally {
    await Promise.all([writer.rollback().catch(()=>{}),observer.rollback().catch(()=>{})]);
    for(const step of undo)await writer.execute(step.sql,step.args).catch(()=>{});
    await Promise.all([writer.end(),observer.end()]);
  }
});
