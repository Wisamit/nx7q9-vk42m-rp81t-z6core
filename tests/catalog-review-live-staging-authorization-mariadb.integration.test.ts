import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { intersectLiveLegacyClinicalDepartments } from "../src/lib/catalog-legacy-clinical-write-auth.ts";

/**
 * Synthetic two-connection MariaDB review-stage authorization.
 * DB grants can change while file parsing is in progress: read only live
 * permissions after the tenant row lock and before claiming any DRAFT batch.
 */
test("MariaDB: spreadsheet reviewer revocation, separate grants, branch and department scopes",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),database:u.pathname.slice(1),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password)};
  const [writer,observer]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),other=randomUUID(),a=randomUUID(),b=randomUUID(),actor=randomUUID();
  const dept=randomUUID(),otherDept=randomUUID(),catalogRole=randomUUID(),priceRole=randomUUID(),rangeRole=randomUUID();
  const batch=randomUUID(),key=org.slice(0,8);
  const undo:Array<{sql:string;args:string[]}>=[];

  async function seed(sql:string,args:string[],undoSql:string,undoArgs:string[]){
    await writer.execute(sql,args);undo.unshift({sql:undoSql,args:undoArgs});
  }
  async function grants(){
    const [rows]=await observer.execute<mysql.RowDataPacket[]>(
      "SELECT DISTINCT p.code FROM users u JOIN organizations o "+
      "ON o.id=u.organization_id AND o.status='ACTIVE' "+
      "JOIN user_roles ur ON ur.user_id=u.id JOIN roles r "+
      "ON r.id=ur.role_id AND r.organization_id=u.organization_id AND r.status='ACTIVE' "+
      "JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id "+
      "WHERE u.id=? AND u.organization_id=? AND u.status='ACTIVE'",[actor,org]);
    return new Set(rows.map(r=>String(r.code)));
  }
  async function branches(){
    const [rows]=await observer.execute<mysql.RowDataPacket[]>(
      "SELECT ub.branch_id FROM user_branch_scopes ub JOIN branches b "+
      "ON b.id=ub.branch_id AND b.status='ACTIVE' AND b.organization_id=? "+
      "WHERE ub.user_id=?",[org,actor]);
    return rows.map(x=>String(x.branch_id));
  }
  async function departments(){
    const [rows]=await observer.execute<mysql.RowDataPacket[]>(
      "SELECT s.department_id,d.organization_id,d.branch_id,d.status "+
      "FROM user_department_scopes s JOIN departments d ON d.id=s.department_id "+
      "WHERE s.user_id=?",[actor]);
    return rows.map(x=>({departmentId:String(x.department_id),
      department:{organizationId:String(x.organization_id),
        branchId:x.branch_id as string|null,status:String(x.status)}}));
  }
  try{
    for(const [id,suffix] of [[org,"O"],[other,"F"]])await seed(
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,"CSR"+key+suffix,"Synthetic Review Tenant"],
      "DELETE FROM organizations WHERE id=?",[id]);
    for(const [id,suffix] of [[a,"A"],[b,"B"]])await seed(
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id,org,"CSR"+key+suffix,"Synthetic Review Branch"],
      "DELETE FROM branches WHERE id=?",[id]);
    for(const [id,branchId,suffix] of [[dept,a,"A"],[otherDept,b,"B"]])await seed(
      "INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id,org,branchId,"CSR"+key+suffix,"Synthetic Review Department"],
      "DELETE FROM departments WHERE id=?",[id]);
    await seed("INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) "+
      "VALUES(?,?,?,?,'ACTIVE',NOW(3))",[actor,org,"csr"+key,"Synthetic Spreadsheet Reviewer"],
      "DELETE FROM users WHERE id=?",[actor]);
    for(const [id,suffix] of [[catalogRole,"C"],[priceRole,"P"],[rangeRole,"R"]])await seed(
      "INSERT INTO roles(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id,org,"CSR"+key+suffix,"Synthetic Review Role"],
      "DELETE FROM roles WHERE id=?",[id]);
    const permissions=["catalog.manage","pricing.manage","catalog.reference_ranges.manage"];
    const ids:string[]=[];
    for(const code of permissions){
      const [existing]=await writer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM permissions WHERE code=? LIMIT 1",[code]);
      const id=(existing[0]?.id as string|undefined)||randomUUID();ids.push(id);
      if(!existing.length)await seed(
        "INSERT INTO permissions(id,code,module) VALUES(?,?,'catalog')",[id,code],
        "DELETE FROM permissions WHERE id=?",[id]);
    }
    for(const [role,permission] of [[catalogRole,ids[0]],[priceRole,ids[1]],[rangeRole,ids[2]]]){
      await seed("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)",
        [actor,role],"DELETE FROM user_roles WHERE user_id=? AND role_id=?",[actor,role]);
      await seed("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",
        [role,permission],"DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",[role,permission]);
    }
    await seed("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",
      [actor,a],"DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[actor,a]);
    await seed("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",
      [actor,dept],"DELETE FROM user_department_scopes WHERE user_id=? AND department_id=?",[actor,dept]);
    await seed("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) "+
      "VALUES(?,?,'CSV_REVIEW','synthetic.csv','DRAFT',?,NOW(3))",[batch,org,actor],
      "DELETE FROM catalog_import_batches WHERE id=?",[batch]);

    const initial=await grants();
    assert.deepEqual([...initial].sort(),permissions.sort(),
      "three separate ACTIVE roles combine for a mixed spreadsheet");
    assert.deepEqual(await branches(),[a],"only active assigned branches count");
    assert.deepEqual(intersectLiveLegacyClinicalDepartments(org,a,[dept],await departments()),[dept]);

    // Serialization lock forces a queued upload to observe committed changes.
    await writer.beginTransaction();
    const [locked]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(locked.length,1);
    await observer.query("SET SESSION innodb_lock_wait_timeout=1");
    await observer.beginTransaction();
    await assert.rejects(observer.execute(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]),
      (e:unknown)=>Boolean(e&&typeof e==="object"&&"code" in e&&e.code==="ER_LOCK_WAIT_TIMEOUT"));
    await observer.rollback();
    await writer.commit();

    await writer.execute("UPDATE roles SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[priceRole]);
    assert.equal((await grants()).has("pricing.manage"),false);
    assert.equal((await grants()).has("catalog.manage"),true);
    await writer.execute("UPDATE roles SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[priceRole]);
    await writer.execute("DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",[rangeRole,ids[2]]);
    assert.equal((await grants()).has("catalog.reference_ranges.manage"),false);
    await writer.execute("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",[rangeRole,ids[2]]);

    await writer.execute("DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[actor,a]);
    assert.deepEqual(await branches(),[],"stale session branch cannot authorize staging");
    await writer.execute("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[actor,b]);
    assert.deepEqual(await branches(),[b],"new grant must not authorize stale active branch A");
    await writer.execute("DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[actor,b]);
    await writer.execute("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[actor,a]);

    await writer.execute("DELETE FROM user_department_scopes WHERE user_id=? AND department_id=?",[actor,dept]);
    assert.equal(intersectLiveLegacyClinicalDepartments(org,a,[dept],await departments()),null);
    await writer.execute("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",[actor,otherDept]);
    assert.equal(intersectLiveLegacyClinicalDepartments(org,a,[dept],await departments()),null);
    await writer.execute("DELETE FROM user_department_scopes WHERE user_id=? AND department_id=?",[actor,otherDept]);
    await writer.execute("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",[actor,dept]);

    await writer.execute("UPDATE users SET status='SUSPENDED',updated_at=NOW(3) WHERE id=?",[actor]);
    assert.deepEqual([...await grants()],[]);
    await writer.execute("UPDATE users SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[actor]);
    await writer.execute("UPDATE organizations SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    assert.deepEqual([...await grants()],[]);
    await writer.execute("UPDATE organizations SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    const [unchanged]=await observer.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM catalog_import_batches WHERE id=?",[batch]);
    assert.equal(unchanged[0].status,"DRAFT","revoked authorization leaves review batch intact");
    assert.deepEqual([...await grants()].sort(),permissions);
  }finally{
    await Promise.all([writer.rollback().catch(()=>{}),observer.rollback().catch(()=>{})]);
    for(const step of undo)await writer.execute(step.sql,step.args).catch(()=>{});
    await Promise.all([writer.end(),observer.end()]);
  }
});
