import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/** Live authorization is observed through independent MariaDB connections. */
test("MariaDB: safe-master commit denies revoked branch, role, permission and inactive tenant", {
  timeout: 90000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u = new URL(process.env.DATABASE_URL);
  const cfg = {host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)};
  const [db,otherConn] = await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreign=randomUUID(),branch=randomUUID(),otherBranch=randomUUID();
  const user=randomUUID(),role=randomUUID(),batch=randomUUID(),key=org.slice(0,8);
  const undo:Array<{sql:string;args:string[]}>=[];

  async function seed(sql:string,args:string[],deleteSql:string,deleteArgs:string[]){
    await db.execute(sql,args);undo.unshift({sql:deleteSql,args:deleteArgs});
  }
  async function allowed(tenant:string,target:string) {
    const [rows]=await otherConn.execute<mysql.RowDataPacket[]>(
      "SELECT DISTINCT u.id FROM users u "+
      "JOIN organizations o ON o.id=u.organization_id AND o.status='ACTIVE' "+
      "JOIN user_roles ur ON ur.user_id=u.id "+
      "JOIN roles r ON r.id=ur.role_id AND r.organization_id=u.organization_id AND r.status='ACTIVE' "+
      "JOIN role_permissions rp ON rp.role_id=r.id "+
      "JOIN permissions p ON p.id=rp.permission_id AND p.code='catalog.manage' "+
      "JOIN user_branch_scopes ub ON ub.user_id=u.id "+
      "JOIN branches b ON b.id=ub.branch_id AND b.organization_id=u.organization_id AND b.status='ACTIVE' "+
      "WHERE u.id=? AND u.organization_id=? AND u.status='ACTIVE' AND b.id=?",
      [user,tenant,target]);
    return rows.length===1;
  }
  try {
    for(const [id,marker] of [[org,"A"],[foreign,"F"]]){
      await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"CMA"+key+marker,"Synthetic Lab Organization"],
        "DELETE FROM organizations WHERE id=?",[id]);
    }
    for(const [id,marker] of [[branch,"A"],[otherBranch,"B"]]){
      await seed("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"CMA"+key+marker,"Synthetic Lab Branch"],
        "DELETE FROM branches WHERE id=?",[id]);
    }
    await seed("INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
      [user,org,"cma"+key,"Synthetic Catalog User"],
      "DELETE FROM users WHERE id=?",[user]);
    await seed("INSERT INTO roles(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [role,org,"CMA"+key,"Synthetic Catalog Role"],
      "DELETE FROM roles WHERE id=?",[role]);
    const [existing]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM permissions WHERE code='catalog.manage' LIMIT 1");
    const perm=(existing[0]?.id as string|undefined)||randomUUID();
    if(!existing.length)
      await seed("INSERT INTO permissions(id,code,module) VALUES(?,'catalog.manage','catalog')",
        [perm],"DELETE FROM permissions WHERE id=?",[perm]);
    await seed("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)",
      [user,role],"DELETE FROM user_roles WHERE user_id=? AND role_id=?",[user,role]);
    await seed("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",
      [role,perm],"DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",[role,perm]);
    await seed("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",
      [user,branch],"DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[user,branch]);
    await seed("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES(?,?,'LEGACY_MDB_EXPORT','synthetic.json','VALIDATED',?,NOW(3))",
      [batch,org,user],"DELETE FROM catalog_import_batches WHERE id=?",[batch]);

    assert.equal(await allowed(org,branch),true);
    assert.equal(await allowed(org,otherBranch),false);
    assert.equal(await allowed(foreign,branch),false);
    // A second connection demonstrates the tenant row lock remains the
    // serialization barrier. After it becomes available, grants are fresh.
    await db.beginTransaction();
    const [lock]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(lock.length,1);
    await otherConn.query("SET SESSION innodb_lock_wait_timeout=1");
    await otherConn.beginTransaction();
    await assert.rejects(otherConn.execute(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]),
      (err:unknown)=>Boolean(err&&typeof err==="object"&&"code" in err&&err.code==="ER_LOCK_WAIT_TIMEOUT"));
    await otherConn.rollback();
    await db.commit();

    await db.execute("DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[user,branch]);
    assert.equal(await allowed(org,branch),false,"a revoked branch never authorizes stale-session import");
    const [unclaimed]=await otherConn.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM catalog_import_batches WHERE id=?",[batch]);
    assert.equal(unclaimed[0].status,"VALIDATED","rejection leaves import batch unclaimed");
    await db.execute("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[user,branch]);

    await db.execute("UPDATE roles SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[role]);
    assert.equal(await allowed(org,branch),false,"inactive role revokes catalog authority");
    await db.execute("UPDATE roles SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[role]);
    await db.execute("DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",[role,perm]);
    assert.equal(await allowed(org,branch),false,"permission revocation blocks commit");
    await db.execute("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",[role,perm]);

    await db.execute("UPDATE users SET status='SUSPENDED',updated_at=NOW(3) WHERE id=?",[user]);
    assert.equal(await allowed(org,branch),false,"inactive user cannot commit");
    await db.execute("UPDATE users SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[user]);
    await db.execute("UPDATE branches SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[branch]);
    assert.equal(await allowed(org,branch),false,"inactive target branch cannot receive masters");
    await db.execute("UPDATE branches SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[branch]);
    await db.execute("UPDATE organizations SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    assert.equal(await allowed(org,branch),false,"inactive organization cannot commit");
    await db.execute("UPDATE organizations SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    assert.equal(await allowed(org,branch),true);
  } finally {
    await Promise.all([db.rollback().catch(()=>{}),otherConn.rollback().catch(()=>{})]);
    for(const task of undo) await db.execute(task.sql,task.args).catch(()=>{});
    await Promise.all([db.end(),otherConn.end()]);
  }
});
