import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {assessClinicalGovernanceScope} from "../src/lib/clinical-rule-governance-scope.ts";

test("Stage 123 MariaDB: live multi-branch and department grants gate organization-wide sign-off",
  {timeout:90_000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)};
  const [db,rival]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),A=randomUUID(),B=randomUUID(),da=randomUUID(),dbid=randomUUID(),
    user=randomUUID(),testId=randomUUID(),target=randomUUID(),rule=randomUUID(),
    suffix=org.slice(0,8);
  const cleanup:Array<{table:string;id:string;column:string}>=[];
  const add=async(table:string,id:string,sql:string,args:Array<string>,column="id")=>{
    await db.execute(sql,args);cleanup.unshift({table,id,column});
  };
  const query=async(sql:string,args:string[]=[])=>{
    const [result]=await db.execute<mysql.RowDataPacket[]>(sql,args);
    return result;
  };
  try{
    await add("organizations",org,
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"S123"+suffix,"Stage 123 synthetic"]);
    for(const [id,k]of [[A,"A"],[B,"B"]]){
      await add("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"S123"+suffix+k,"Synthetic branch"]);
    }
    for(const [id,k,bid]of [[da,"A",A],[dbid,"B",B]]){
      await add("departments",id,
        "INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,org,bid,"S123"+suffix+k,"Synthetic department"]);
    }
    await add("users",user,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [user,org,"s123"+suffix,"Synthetic approver"]);
    await add("user_branch_scopes",A,
      "INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",
      [user,A],"branch_id");
    for(const [id,k]of [[testId,"SRC"],[target,"DST"]]){
      await add("lab_tests",id,
        "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"S123"+suffix+k,"Synthetic clinical test"]);
    }
    await add("reflex_rules",rule,
      "INSERT INTO reflex_rules(id,organization_id,source_test_id,target_test_id,operator,numeric_threshold,effective_from,status,updated_at) VALUES(?,?,?,?,'LT',1,NOW(3),'INACTIVE',NOW(3))",
      [rule,org,testId,target]);

    // Minimal Prisma-compatible method facades whose rows are queried
    // from actual MariaDB. No mocked grants or branch status.
    const tx={
      branch:{findMany:async()=>query(
        "SELECT id FROM branches WHERE organization_id=? AND status='ACTIVE'",[org])},
      userBranchScope:{findMany:async()=>query(
        "SELECT s.branch_id AS branchId FROM user_branch_scopes s "+
        "JOIN branches b ON b.id=s.branch_id "+
        "WHERE s.user_id=? AND b.organization_id=? AND b.status='ACTIVE'",[user,org])},
      department:{findMany:async()=>query(
        "SELECT d.id FROM departments d LEFT JOIN branches b ON b.id=d.branch_id "+
        "WHERE d.organization_id=? AND d.status='ACTIVE' AND "+
        "(d.branch_id IS NULL OR (b.organization_id=? AND b.status='ACTIVE'))",[org,org])},
      userDepartmentScope:{findMany:async()=>query(
        "SELECT s.department_id AS departmentId FROM user_department_scopes s "+
        "JOIN departments d ON d.id=s.department_id "+
        "WHERE s.user_id=? AND d.organization_id=? AND d.status='ACTIVE'",[user,org])},
    } as unknown as Parameters<typeof assessClinicalGovernanceScope>[0];
    const check=(authorizationBranchId:string|null,branchIds:string[],departments:string[]=[])=>
      assessClinicalGovernanceScope(tx,{organizationId:org,userId:user,
        activeBranchId:A,authorizationBranchId,
        sessionBranchIds:branchIds,sessionDepartmentIds:departments});

    assert.deepEqual(await check(null,[A]),{
      ok:false,error:"clinical_rule_organization_wide_branch_coverage_required",
    });
    assert.equal((await check(A,[A])).ok,true);
    assert.deepEqual(await check(B,[A]),{
      ok:false,error:"clinical_rule_branch_scope_mismatch",
    });

    await add("user_branch_scopes",B,
      "INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",
      [user,B],"branch_id");
    assert.equal((await check(null,[A,B])).ok,true);
    assert.equal((await check(null,[A])).ok,false,
      "session snapshot must not auto-expand after a new branch grant");

    await add("user_department_scopes",da,
      "INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",
      [user,da],"department_id");
    assert.deepEqual(await check(null,[A,B],[da]),{
      ok:false,error:"clinical_rule_organization_wide_department_coverage_required",
    });
    await add("user_department_scopes",dbid,
      "INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",
      [user,dbid],"department_id");
    assert.equal((await check(null,[A,B],[da,dbid])).ok,true);

    // Another MariaDB connection revokes B while the draft is still idle.
    // The next authorization check must not treat the old session as proof.
    await rival.execute(
      "DELETE FROM user_branch_scopes WHERE user_id=? AND branch_id=?",[user,B]);
    assert.deepEqual(await check(null,[A,B],[da,dbid]),{
      ok:false,error:"clinical_rule_organization_wide_branch_coverage_required",
    });
    const [status]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM reflex_rules WHERE id=? AND organization_id=?",[rule,org]);
    assert.equal(status[0].status,"INACTIVE");
    const [evidence]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM audit_events WHERE entity_type='ReflexRule' AND entity_id=?",[rule]);
    assert.equal(Number(evidence[0].total),0,
      "denied organization-wide approval cannot fabricate a clinical audit event");
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
    for(const entry of cleanup)await db.execute(
      "DELETE FROM "+entry.table+" WHERE "+entry.column+"=?"+(
        entry.table==="user_branch_scopes"||entry.table==="user_department_scopes"?
        " AND user_id=?":""),[entry.id,...(
        entry.table==="user_branch_scopes"||entry.table==="user_department_scopes"?[user]:[])])
      .catch(()=>{});
    await Promise.all([db.end(),rival.end()]);
  }
});
