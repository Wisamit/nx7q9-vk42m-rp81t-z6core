import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/** Disposable synthetic MariaDB evidence for the real legacy staging schema. */
test("MariaDB: legacy JSON stage/revalidate live permissions, owner and optimistic row revision",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [db,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),branch=randomUUID(),user=randomUUID(),other=randomUUID();
  const role=randomUUID(),batch=randomUUID(),row=randomUUID(),tag=org.slice(0,8);
  const cleanup:Array<{sql:string;args:string[]}>=[];

  async function seed(sql:string,args:string[],deleteSql:string,deleteArgs:string[]){
    await db.execute(sql,args);cleanup.unshift({sql:deleteSql,args:deleteArgs});
  }
  async function allowed(userId:string,permission:string){
    const [found]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT DISTINCT u.id FROM users u "+
      "JOIN organizations o ON o.id=u.organization_id AND o.status='ACTIVE' "+
      "JOIN user_roles ur ON ur.user_id=u.id "+
      "JOIN roles r ON r.id=ur.role_id AND r.organization_id=u.organization_id AND r.status='ACTIVE' "+
      "JOIN role_permissions rp ON rp.role_id=r.id "+
      "JOIN permissions p ON p.id=rp.permission_id AND p.code=? "+
      "JOIN user_branch_scopes bs ON bs.user_id=u.id "+
      "JOIN branches b ON b.id=bs.branch_id AND b.organization_id=u.organization_id AND b.status='ACTIVE' "+
      "WHERE u.id=? AND u.organization_id=? AND u.status='ACTIVE' AND b.id=?",
      [permission,userId,org,branch]);
    return found.length===1;
  }

  try{
    await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"LVR"+tag,"Synthetic legacy tenant"],"DELETE FROM organizations WHERE id=?",[org]);
    await seed("INSERT INTO branches(id,organization_id,code,name_en,updated_at) "+
      "VALUES(?,?,?,?,NOW(3))",
      [branch,org,"LVR"+tag+"B","Synthetic branch"],"DELETE FROM branches WHERE id=?",[branch]);
    for(const [id,suffix] of [[user,"A"],[other,"B"]])await seed(
      "INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) "+
      "VALUES(?,?,?,?,'ACTIVE',NOW(3))",[id,org,"lvr"+tag+suffix,"Synthetic reviewer"],
      "DELETE FROM users WHERE id=?",[id]);
    await seed("INSERT INTO roles(id,organization_id,code,name_en,updated_at) "+
      "VALUES(?,?,?,?,NOW(3))",[role,org,"LVR"+tag,"Synthetic catalog role"],
      "DELETE FROM roles WHERE id=?",[role]);
    const codes=["catalog.manage","pricing.manage","catalog.reference_ranges.manage"];
    const perms:string[]=[];
    for(const code of codes){
      const [found]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM permissions WHERE code=? LIMIT 1",[code]);
      const id=(found[0]?.id as string|undefined)||randomUUID();perms.push(id);
      if(!found.length)await seed(
        "INSERT INTO permissions(id,code,module) VALUES(?,?,'catalog')",[id,code],
        "DELETE FROM permissions WHERE id=?",[id]);
    }
    await seed("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)",[user,role],
      "DELETE FROM user_roles WHERE user_id=? AND role_id=?",[user,role]);
    for(const perm of perms)await seed(
      "INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",[role,perm],
      "DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",[role,perm]);
    await seed("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",
      [user,branch],"DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[user,branch]);
    await seed("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,"+
      "status,created_by_user_id,updated_at) "+
      "VALUES(?,?,'LEGACY_MDB_EXPORT','synthetic.json','DRAFT',?,NOW(3))",
      [batch,org,user],"DELETE FROM catalog_import_batches WHERE id=?",[batch]);
    await seed("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,"+
      "source_data,updated_at) VALUES(?,?,1,'TEST','PENDING',?,NOW(3))",
      [row,batch,JSON.stringify({code:"LV1",nameEn:"Synthetic test"})],
      "DELETE FROM catalog_import_rows WHERE id=?",[row]);

    assert.equal(await allowed(user,"catalog.manage"),true);
    assert.equal(await allowed(user,"pricing.manage"),true);
    assert.equal(await allowed(user,"catalog.reference_ranges.manage"),true);
    assert.equal(await allowed(other,"catalog.manage"),false);

    const [owned]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM catalog_import_batches WHERE id=? AND organization_id=? AND created_by_user_id=?",
      [batch,org,other]);
    assert.equal(owned.length,0,"another user's batch must remain private");
    const [creator]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM catalog_import_batches WHERE id=? AND organization_id=? AND created_by_user_id=?",
      [batch,org,user]);
    assert.equal(creator.length,1);

    await db.beginTransaction();
    const [lock]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(lock.length,1);
    await reader.query("SET SESSION innodb_lock_wait_timeout=1");
    await reader.beginTransaction();
    await assert.rejects(reader.execute(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]),
      (error:unknown)=>Boolean(error&&typeof error==="object"&&"code" in error&&
        error.code==="ER_LOCK_WAIT_TIMEOUT"));
    await reader.rollback();await db.commit();

    await db.execute("DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",
      [role,perms[1]]);
    assert.equal(await allowed(user,"pricing.manage"),false);
    assert.equal(await allowed(user,"catalog.manage"),true);
    await db.execute("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",
      [role,perms[1]]);
    await db.execute("UPDATE roles SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[role]);
    assert.equal(await allowed(user,"catalog.manage"),false);
    await db.execute("UPDATE roles SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[role]);
    await db.execute("DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[user,branch]);
    assert.equal(await allowed(user,"catalog.manage"),false);
    await db.execute("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[user,branch]);
    await db.execute("UPDATE organizations SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    assert.equal(await allowed(user,"catalog.manage"),false);
    await db.execute("UPDATE organizations SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    assert.equal(await allowed(user,"catalog.manage"),true);

    const [source]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT updated_at FROM catalog_import_rows WHERE id=?",[row]);
    // Another transaction may import the source row while a pre-lock
    // validation runs. Revalidation must not downgrade that released state.
    await db.execute("UPDATE catalog_import_rows SET status='IMPORTED',imported_entity_id=?,"+
      "updated_at=DATE_ADD(NOW(3),INTERVAL 1 SECOND) WHERE id=?",[randomUUID(),row]);
    const [claim]=await reader.execute<mysql.ResultSetHeader>(
      "UPDATE catalog_import_rows SET status='VALID' WHERE id=? AND batch_id=? "+
      "AND updated_at=? AND status NOT IN ('IMPORTED','SKIPPED') AND imported_entity_id IS NULL",
      [row,batch,source[0].updated_at]);
    assert.equal(claim.affectedRows,0,"imported rows cannot be silently restored to VALID");
    const [unchanged]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT status,imported_entity_id FROM catalog_import_rows WHERE id=?",[row]);
    assert.equal(unchanged[0].status,"IMPORTED");
    assert.ok(unchanged[0].imported_entity_id);

    const [oldBatch]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT updated_at FROM catalog_import_batches WHERE id=?",[batch]);
    await db.execute("UPDATE catalog_import_batches SET updated_at="+
      "DATE_ADD(NOW(3),INTERVAL 1 SECOND) WHERE id=?",[batch]);
    const [stale]=await reader.execute<mysql.ResultSetHeader>(
      "UPDATE catalog_import_batches SET status='VALIDATED' WHERE id=? AND organization_id=? "+
      "AND created_by_user_id=? AND status IN ('DRAFT','VALIDATED') AND updated_at=?",
      [batch,org,user,oldBatch[0].updated_at]);
    assert.equal(stale.affectedRows,0,"stale revalidations cannot overwrite a newer batch");
    const [status]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM catalog_import_batches WHERE id=?",[batch]);
    assert.equal(status[0].status,"DRAFT");
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),reader.rollback().catch(()=>{})]);
    for(const item of cleanup)await db.execute(item.sql,item.args).catch(()=>{});
    await Promise.all([db.end(),reader.end()]);
  }
});
