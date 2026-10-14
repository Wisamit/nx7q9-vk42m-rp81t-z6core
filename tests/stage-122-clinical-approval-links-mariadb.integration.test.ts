import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {validateClinicalRuleApprovalReferences} from "../src/lib/clinical-rule-approval-references.ts";

test("Stage 122 MariaDB: actual inactive clinical master records deny signed Reflex/Delta draft activation",
  {timeout:90000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)};
  const db=await mysql.createConnection(config);
  const org=randomUUID(),branch=randomUUID(),department=randomUUID(),user=randomUUID(),
    source=randomUUID(),target=randomUUID(),component=randomUUID(),method=randomUUID(),
    reflex=randomUUID(),delta=randomUUID(),suffix=org.slice(0,8);
  const cleanup:{table:string;id:string}[]=[];
  const add=async(table:string,id:string,sql:string,args:(string|null)[])=>{
    await db.execute(sql,args);cleanup.unshift({table,id});
  };
  const row=async(sql:string,args:(string|null)[])=>{
    const [records]=await db.execute<mysql.RowDataPacket[]>(sql,args);
    return records[0]||null;
  };
  try{
    await add("organizations",org,
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"S122"+suffix,"Synthetic organization"]);
    await add("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S122"+suffix,"Synthetic branch"]);
    await add("departments",department,
      "INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [department,org,branch,"S122"+suffix,"Synthetic department"]);
    await add("users",user,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [user,org,"s122"+suffix,"Synthetic validator"]);
    for(const [id,code] of [[source,"SOURCE"],[target,"TARGET"]]){
      await add("lab_tests",id,
        "INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,result_type,updated_at) VALUES(?,?,?,?,?,'NUMERIC',NOW(3))",
        [id,org,department,"S122"+suffix+code,"Synthetic clinical test"]);
    }
    await add("test_components",component,
      "INSERT INTO test_components(id,test_id,code,name_en,result_type,updated_at) VALUES(?,?,?,?,'NUMERIC',NOW(3))",
      [component,source,"S122_COMPONENT","Synthetic numeric component"]);
    await add("methods",method,
      "INSERT INTO methods(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [method,org,"S122"+suffix,"Synthetic method"]);
    await add("reflex_rules",reflex,
      "INSERT INTO reflex_rules(id,organization_id,source_test_id,source_component_id,branch_id,target_test_id,operator,numeric_threshold,effective_from,status,updated_at) VALUES(?,?,?,?,?,?,'LT',0.00000001,NOW(3),'INACTIVE',NOW(3))",
      [reflex,org,source,component,branch,target]);
    await add("delta_rules",delta,
      "INSERT INTO delta_rules(id,organization_id,test_id,component_id,branch_id,method_id,absolute_limit,lookback_days,effective_from,status,updated_at) VALUES(?,?,?,?,?,?,0.00000001,365,NOW(3),'INACTIVE',NOW(3))",
      [delta,org,source,component,branch,method]);

    const fixture={
      userDepartmentScope:{findMany:async()=>{
        const [entries]=await db.execute<mysql.RowDataPacket[]>(
          "SELECT department_id FROM user_department_scopes WHERE user_id=?",[user]);
        return entries.map(entry=>({departmentId:entry.department_id,
          department:{organizationId:org,status:"ACTIVE",branch:{
            organizationId:org,status:"ACTIVE"}}}));
      }},
      branch:{findFirst:async({where}:{where:{id:string;organizationId:string;status:string}})=>{
        const r=await row(
          "SELECT id FROM branches WHERE id=? AND organization_id=? AND status=?",
          [where.id,where.organizationId,where.status]);
        return r?{id:r.id}:null;
      }},
      method:{findFirst:async({where}:{where:{id:string;organizationId:string;status:string}})=>{
        const r=await row("SELECT id FROM methods WHERE id=? AND organization_id=? AND status=?",
          [where.id,where.organizationId,where.status]);
        return r?{id:r.id}:null;
      }},
      reflexRule:{findFirst:async({where}:{where:{id:string;organizationId:string}})=>{
        const r=await row(
          "SELECT source_test_id AS sourceTestId, target_test_id AS targetTestId, "+
          "source_component_id AS sourceComponentId, branch_id AS branchId, "+
          "operator, numeric_threshold AS numericThreshold,text_threshold AS textThreshold "+
          "FROM reflex_rules WHERE id=? AND organization_id=?",[where.id,where.organizationId]);
        return r||null;
      }},
      deltaRule:{findFirst:async({where}:{where:{id:string;organizationId:string}})=>{
        const r=await row(
          "SELECT test_id AS testId,component_id AS componentId,branch_id AS branchId, "+
          "method_id AS methodId,absolute_limit AS absoluteLimit,percent_limit AS percentLimit "+
          "FROM delta_rules WHERE id=? AND organization_id=?",[where.id,where.organizationId]);
        return r||null;
      }},
      labTest:{findFirst:async({where}:{where:{id:string;organizationId:string;status:string}})=>{
        const r=await row(
          "SELECT t.id,t.result_type AS resultType,t.department_id AS departmentId, "+
          "d.organization_id AS depOrg,d.status AS depStatus,b.organization_id AS depBranchOrg, "+
          "b.status AS depBranchStatus FROM lab_tests t "+
          "LEFT JOIN departments d ON d.id=t.department_id "+
          "LEFT JOIN branches b ON b.id=d.branch_id "+
          "WHERE t.id=? AND t.organization_id=? AND t.status=?",
          [where.id,where.organizationId,where.status]);
        if(!r)return null;
        const [components]=await db.execute<mysql.RowDataPacket[]>(
          "SELECT id,code,status,result_type AS resultType FROM test_components WHERE test_id=?",[r.id]);
        return {id:r.id,resultType:r.resultType,departmentId:r.departmentId,
          department:r.departmentId?{
            organizationId:r.depOrg,status:r.depStatus,
            branch:r.depBranchOrg?{organizationId:r.depBranchOrg,status:r.depBranchStatus}:null,
          }:null,components};
      }},
    } as unknown as Parameters<typeof validateClinicalRuleApprovalReferences>[0];
    const verify=(type:"REFLEX_RULE"|"DELTA_RULE",id:string,sessionDepartmentIds:string[]=[])=>
      validateClinicalRuleApprovalReferences(fixture,{
        type,id,organizationId:org,activeBranchId:branch,userId:user,
        sessionDepartmentIds,
      });
    assert.deepEqual(await verify("REFLEX_RULE",reflex),{ok:true});
    assert.deepEqual(await verify("DELTA_RULE",delta),{ok:true});
    await db.execute("UPDATE lab_tests SET status='INACTIVE' WHERE id=?",[target]);
    assert.deepEqual(await verify("REFLEX_RULE",reflex),
      {ok:false,error:"clinical_rule_test_inactive_or_forbidden"});
    await db.execute("UPDATE lab_tests SET status='ACTIVE' WHERE id=?",[target]);
    await db.execute("UPDATE test_components SET status='INACTIVE' WHERE id=?",[component]);
    for(const [type,id] of [["REFLEX_RULE",reflex],["DELTA_RULE",delta]] as const)
      assert.deepEqual(await verify(type,id),
        {ok:false,error:"clinical_rule_source_component_inactive_or_mismatched"});
    await db.execute("UPDATE test_components SET status='ACTIVE' WHERE id=?",[component]);
    await db.execute("UPDATE methods SET status='INACTIVE' WHERE id=?",[method]);
    assert.deepEqual(await verify("DELTA_RULE",delta),
      {ok:false,error:"clinical_rule_method_inactive_or_forbidden"});
    await db.execute("UPDATE methods SET status='ACTIVE' WHERE id=?",[method]);
    await db.execute("UPDATE branches SET status='INACTIVE' WHERE id=?",[branch]);
    assert.deepEqual(await verify("REFLEX_RULE",reflex),
      {ok:false,error:"clinical_rule_branch_inactive_or_forbidden"});
    await db.execute("UPDATE branches SET status='ACTIVE' WHERE id=?",[branch]);
    assert.deepEqual(await verify("REFLEX_RULE",reflex,[department]),
      {ok:false,error:"clinical_rule_department_scope_revoked"});
    const [statuses]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM reflex_rules WHERE id=?",[reflex]);
    assert.equal(statuses[0].status,"INACTIVE","rejection cannot activate a rule");
  }finally{
    for(const entry of cleanup)await db.execute(
      "DELETE FROM "+entry.table+" WHERE id=?",[entry.id]).catch(()=>{});
    await db.end();
  }
});
