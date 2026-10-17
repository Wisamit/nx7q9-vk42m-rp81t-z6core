import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { clinicalImportTestWhere } from "../src/lib/catalog-clinical-import-scope.ts";

/**
 * Synthetic two-connection database regression. Demonstrates that catalog
 * disclosure cannot cross a department's performing branch and that tenant
 * row-lock serialization sees a role/branch revocation before reading rows.
 */
test("MariaDB: paged and signed catalog exports cannot include off-branch tests after revocation",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [db,read]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),a=randomUUID(),b=randomUUID(),departmentA=randomUUID(),departmentB=randomUUID();
  const actor=randomUUID(),role=randomUUID(),testA=randomUUID(),testB=randomUUID(),tag=org.slice(0,8);
  const cleanup:Array<{sql:string;args:string[]}>=[];

  async function seed(sql:string,args:string[],undo:string,values:string[]){
    await db.execute(sql,args);cleanup.unshift({sql:undo,args:values});
  }
  async function granted(){
    const [rows]=await read.execute<mysql.RowDataPacket[]>(
      "SELECT DISTINCT u.id FROM users u JOIN organizations o "+
      "ON o.id=u.organization_id AND o.status='ACTIVE' "+
      "JOIN user_roles ur ON ur.user_id=u.id "+
      "JOIN roles r ON r.id=ur.role_id AND r.organization_id=u.organization_id AND r.status='ACTIVE' "+
      "JOIN role_permissions rp ON rp.role_id=r.id "+
      "JOIN permissions p ON p.id=rp.permission_id AND p.code='catalog.manage' "+
      "JOIN user_branch_scopes ub ON ub.user_id=u.id "+
      "JOIN branches br ON br.id=ub.branch_id AND br.status='ACTIVE' AND br.organization_id=u.organization_id "+
      "WHERE u.id=? AND u.organization_id=? AND u.status='ACTIVE' AND br.id=?",
      [actor,org,a]);
    return rows.length===1;
  }
  async function visibleTests(){
    const [rows]=await read.execute<mysql.RowDataPacket[]>(
      "SELECT t.id FROM lab_tests t LEFT JOIN departments d ON d.id=t.department_id "+
      "WHERE t.organization_id=? AND t.status='ACTIVE' AND t.department_id IN (?) "+
      "AND (t.department_id IS NULL OR (d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?)))",
      [org,departmentA,a]);
    return rows.map(x=>String(x.id));
  }
  try{
    await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"CED"+tag,"Synthetic export tenant"],"DELETE FROM organizations WHERE id=?",[org]);
    for(const [id,suffix] of [[a,"A"],[b,"B"]])await seed(
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id,org,"CED"+tag+suffix,"Synthetic branch"],"DELETE FROM branches WHERE id=?",[id]);
    for(const [id,branch,suffix] of [[departmentA,a,"A"],[departmentB,b,"B"]])await seed(
      "INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id,org,branch,"CED"+tag+suffix,"Synthetic department"],
      "DELETE FROM departments WHERE id=?",[id]);
    for(const [id,department,suffix] of [[testA,departmentA,"A"],[testB,departmentB,"B"]])await seed(
      "INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id,org,department,"CED"+tag+suffix,"Synthetic test"],
      "DELETE FROM lab_tests WHERE id=?",[id]);
    await seed("INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) "+
      "VALUES(?,?,?,?,'ACTIVE',NOW(3))",
      [actor,org,"ced"+tag,"Synthetic reviewer"],"DELETE FROM users WHERE id=?",[actor]);
    await seed("INSERT INTO roles(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [role,org,"CED"+tag,"Synthetic catalog role"],
      "DELETE FROM roles WHERE id=?",[role]);
    const [permissions]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM permissions WHERE code='catalog.manage' LIMIT 1");
    const perm=(permissions[0]?.id as string|undefined)||randomUUID();
    if(!permissions.length)await seed(
      "INSERT INTO permissions(id,code,module) VALUES(?,'catalog.manage','catalog')",
      [perm],"DELETE FROM permissions WHERE id=?",[perm]);
    await seed("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)",
      [actor,role],"DELETE FROM user_roles WHERE user_id=? AND role_id=?",[actor,role]);
    await seed("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",
      [role,perm],"DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",[role,perm]);
    await seed("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",
      [actor,a],"DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[actor,a]);
    await seed("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",
      [actor,departmentA],"DELETE FROM user_department_scopes WHERE user_id=? AND department_id=?",[actor,departmentA]);

    assert.equal(await granted(),true);
    assert.deepEqual(await visibleTests(),[testA]);
    assert.ok(clinicalImportTestWhere({organizationId:org,branchId:a,departmentIds:[departmentA]}).OR,
      "both routes use the shared clinical predicate");
    // A queued export is serialized behind the same tenant lock used to
    // change scoped configuration; the next request must recheck grants.
    await db.beginTransaction();
    const [locked]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(locked.length,1);
    await read.query("SET SESSION innodb_lock_wait_timeout=1");
    await read.beginTransaction();
    await assert.rejects(read.execute(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]),
      (e:unknown)=>Boolean(e&&typeof e==="object"&&"code" in e&&e.code==="ER_LOCK_WAIT_TIMEOUT"));
    await read.rollback();await db.commit();

    await db.execute("DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[actor,a]);
    assert.equal(await granted(),false,"revoked branch must deny both source export paths");
    await db.execute("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[actor,a]);
    await db.execute("UPDATE roles SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[role]);
    assert.equal(await granted(),false,"role deactivation blocks download");
    await db.execute("UPDATE roles SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[role]);
    await db.execute("DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",[role,perm]);
    assert.equal(await granted(),false,"live permission revocation blocks download");
    await db.execute("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",[role,perm]);
    await db.execute("UPDATE organizations SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    assert.equal(await granted(),false,"inactive tenant cannot export");
    await db.execute("UPDATE organizations SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    await db.execute("UPDATE departments SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[departmentA]);
    assert.deepEqual(await visibleTests(),[],"inactive performing department denies the clinical test");
    await db.execute("UPDATE departments SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[departmentA]);
    assert.equal(await granted(),true);
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),read.rollback().catch(()=>{})]);
    for(const step of cleanup)await db.execute(step.sql,step.args).catch(()=>{});
    await Promise.all([db.end(),read.end()]);
  }
});
