import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage142 MariaDB: reviewer role and branch are live, same-identity approval lock excludes competitors",{
  timeout:90000,
},async()=>{
  const value=process.env.DATABASE_URL;
  if(!value) throw Error("DATABASE_URL required");
  const u=new URL(value);
  const config={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [first,second]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),
    author=randomUUID(),reviewer=randomUUID(),role=randomUUID(),hash=createHash("sha256").update(randomUUID()).digest("hex"),
    suffix=org.slice(0,8);
  const clean:Array<{sql:string;args:(string|number)[]}>=[];

  async function put(sql:string,args:(string|number)[],undo:string,undoArgs:(string|number)[]){
    await first.execute(sql,args);
    clean.unshift({sql:undo,args:undoArgs});
  }
  const authorized=async (targetBranch:string, tenant:string, actor=reviewer)=>{
    const [rows]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT DISTINCT u.id FROM users u "+
      "JOIN organizations o ON o.id=u.organization_id AND o.status='ACTIVE' "+
      "JOIN user_roles ur ON ur.user_id=u.id "+
      "JOIN roles r ON r.id=ur.role_id AND r.organization_id=u.organization_id AND r.status='ACTIVE' "+
      "JOIN role_permissions rp ON rp.role_id=r.id "+
      "JOIN permissions p ON p.id=rp.permission_id AND p.code='analyzers.mappings.approve' "+
      "JOIN user_branch_scopes ub ON ub.user_id=u.id "+
      "JOIN branches b ON b.id=ub.branch_id AND b.organization_id=u.organization_id AND b.status='ACTIVE' "+
      "WHERE u.id=? AND u.organization_id=? AND u.status='ACTIVE' AND b.id=?",
      [actor,tenant,targetBranch]);
    return rows.length===1;
  };
  try {
    for(const [id,tag] of [[org,"A"],[foreignOrg,"F"]]){
      await put("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S142"+suffix+tag,"Synthetic Analyzer Governance Lab"],
        "DELETE FROM organizations WHERE id=?",[id]);
    }
    for(const [id,tag] of [[branch,"A"],[otherBranch,"B"]]){
      await put("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"S142"+suffix+tag,"Synthetic Branch"],"DELETE FROM branches WHERE id=?",[id]);
    }
    for(const [id,tag] of [[author,"A"],[reviewer,"R"]]){
      await put("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"s142"+suffix+tag,"Synthetic Reviewer"],"DELETE FROM users WHERE id=?",[id]);
    }
    await put("INSERT INTO roles(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [role,org,"S142"+suffix,"Independent Mapping Reviewer"],"DELETE FROM roles WHERE id=?",[role]);
    const [existing]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM permissions WHERE code='analyzers.mappings.approve' LIMIT 1");
    const perm=existing[0]?.id as string|undefined || randomUUID();
    if(!existing.length){
      await put("INSERT INTO permissions(id,code,module) VALUES(?,'analyzers.mappings.approve','analyzers')",
        [perm],"DELETE FROM permissions WHERE id=?",[perm]);
    }
    await put("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)",[reviewer,role],
      "DELETE FROM user_roles WHERE user_id=? AND role_id=?",[reviewer,role]);
    await put("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",[role,perm],
      "DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",[role,perm]);
    await put("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[reviewer,branch],
      "DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[reviewer,branch]);
    await put("INSERT INTO clinical_rule_governance_locks(organization_id,rule_type,identity_hash,updated_at) VALUES(?,'ANALYZER_TEST_MAPPING',?,NOW(3))",
      [org,hash],"DELETE FROM clinical_rule_governance_locks WHERE organization_id=? AND rule_type='ANALYZER_TEST_MAPPING' AND identity_hash=?",[org,hash]);

    assert.equal(await authorized(branch,org),true);
    assert.equal(await authorized(otherBranch,org),false,"ungranted neighboring branch excluded");
    assert.equal(await authorized(branch,foreignOrg),false,"cross-tenant reviewer excluded");
    assert.equal(await authorized(branch,org,author),false,"draft author has no reviewer entitlement");

    await first.beginTransaction();
    const [lock]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT organization_id FROM clinical_rule_governance_locks "+
      "WHERE organization_id=? AND rule_type='ANALYZER_TEST_MAPPING' AND identity_hash=? FOR UPDATE",
      [org,hash]);
    assert.equal(lock.length,1);
    await second.query("SET SESSION innodb_lock_wait_timeout=1");
    await second.beginTransaction();
    await assert.rejects(second.execute(
      "SELECT organization_id FROM clinical_rule_governance_locks "+
      "WHERE organization_id=? AND rule_type='ANALYZER_TEST_MAPPING' AND identity_hash=? FOR UPDATE",
      [org,hash]),(error:unknown)=>Boolean(error&&typeof error==="object"&&
      "code" in error&&error.code==="ER_LOCK_WAIT_TIMEOUT"));
    await second.rollback();
    await first.commit();

    await second.execute("DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[reviewer,branch]);
    assert.equal(await authorized(branch,org),false,"a stale session must not retain revoked branch access");
    await second.execute("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[reviewer,branch]);
    await second.execute("UPDATE roles SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[role]);
    assert.equal(await authorized(branch,org),false,"revoked reviewer role must be rejected");
    await second.execute("UPDATE roles SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[role]);
    await second.execute("UPDATE users SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[reviewer]);
    assert.equal(await authorized(branch,org),false,"deactivated user cannot review");
    await second.execute("UPDATE users SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[reviewer]);
    await second.execute("UPDATE branches SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[branch]);
    assert.equal(await authorized(branch,org),false,"deactivated branch cannot approve analyzer routing");
    await second.execute("UPDATE branches SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[branch]);
    await second.execute("UPDATE organizations SET status='INACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    assert.equal(await authorized(branch,org),false,"deactivated tenant cannot approve clinical routing");
    await second.execute("UPDATE organizations SET status='ACTIVE',updated_at=NOW(3) WHERE id=?",[org]);
    assert.equal(await authorized(branch,org),true,"restored authorized reviewer has exact branch permission");
  }finally{
    await Promise.all([first.rollback().catch(()=>{}),second.rollback().catch(()=>{})]);
    for(const task of clean)await first.execute(task.sql,task.args).catch(()=>{});
    await Promise.all([first.end(),second.end()]);
  }
});
