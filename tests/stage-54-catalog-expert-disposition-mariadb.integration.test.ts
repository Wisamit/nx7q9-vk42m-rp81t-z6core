import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { expertDispositionAllowed } from "../src/lib/catalog-expert-disposition.ts";
import { catalogDriftObservationToken } from "../src/lib/catalog-drift-triage.ts";

test("Stage 54 MariaDB: independently granted second expert, revocation, stale evidence, immutable decision and cross-tenant isolation",
{timeout:45000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const config={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [writer,expert]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),dept=randomUUID(),
    labTest=randomUUID(),foreignTest=randomUUID(),author=randomUUID(),reviewer=randomUUID(),
    roleId=randomUUID(),batch=randomUUID(),row=randomUUID(),flag=randomUUID(),decision=randomUUID();
  const prefix="S54"+org.slice(0,8);
  const secret="stage-54-only-MariaDB-HMAC-test-secret-ABC123";
  const source={id:labTest,code:prefix+"T",nameEn:"Before"};
  const original={...source};
  const originalToken=catalogDriftObservationToken(secret,"a".repeat(64),1,"TEST",source,original);
  const createdPermissions:string[]=[];
  const insert=(sql:string,args:Array<string|number|null>)=>writer.execute(sql,args);
  try{
    for(const [id,name] of [[org,"A"],[foreignOrg,"F"]])
      await insert("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+name,"Stage54 Organization"]);
    await insert("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,prefix+"B","Stage54 Branch"]);
    await insert("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [dept,org,branch,prefix+"D","Stage54 Department"]);
    for(const [id,tenant,department,suffix] of [
      [labTest,org,dept,"T"],[foreignTest,foreignOrg,null,"F"],
    ])await insert("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [id,tenant,department,prefix+suffix,"Before"]);
    for(const [id,suffix] of [[author,"A"],[reviewer,"R"]])
      await insert("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+suffix,"Stage54 User"]);
    await insert("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[reviewer,branch]);
    await insert("INSERT INTO user_department_scopes(user_id,department_id) VALUES(?,?)",[reviewer,dept]);
    await insert("INSERT INTO roles(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [roleId,org,prefix+"R","Stage54 Clinical Reviewer"]);
    await insert("INSERT INTO user_roles(user_id,role_id) VALUES(?,?)",[reviewer,roleId]);
    const permissionIds:string[]=[];
    for(const code of ["catalog.manage","catalog.reference_ranges.manage"]){
      const [existing]=await writer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM permissions WHERE code=?",[code]);
      if(existing.length){permissionIds.push(String(existing[0].id));continue;}
      const id=randomUUID();
      await insert("INSERT INTO permissions(id,code,module) VALUES(?,?,'catalog')",[id,code]);
      createdPermissions.push(id);permissionIds.push(id);
    }
    for(const id of permissionIds)
      await insert("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",[roleId,id]);
    await insert("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage54.json',?,'DRAFT',?,NOW(3))",
      [batch,org,"a".repeat(64),author]);
    await insert("INSERT INTO catalog_import_rows(id,batch_id,row_number,entity_type,status,legacy_key,source_data,normalized_data,validation_issues,updated_at) VALUES(?,?,1,'TEST','WARNING',?,?,?,?,NOW(3))",
      [row,batch,labTest,JSON.stringify(source),JSON.stringify(source),
        JSON.stringify([{severity:"WARNING",code:"CONFIGURATION_BUNDLE_REVIEW_ONLY"}])]);
    await insert("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED','CatalogImportRow',?,?)",
      [flag,org,branch,author,row,JSON.stringify({
        batchId:batch,rowNumber:1,entityType:"TEST",category:"CLINICAL",
        evidenceToken:originalToken,reasonCode:"REQUIRES_DOMAIN_ASSESSMENT",
        reviewOnly:true,approved:false,activated:false,
      })]);

    await writer.beginTransaction();
    const [held]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(held.length,1);
    await expert.execute("SET SESSION innodb_lock_wait_timeout=8");
    await expert.beginTransaction();
    const pending=expert.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    await writer.execute("DELETE FROM user_branch_scopes WHERE user_id=?",[reviewer]);
    await writer.execute("DELETE FROM role_permissions WHERE role_id=? AND permission_id=?",
      [roleId,permissionIds[1]]);
    await writer.commit();
    const [lock]=await pending;
    assert.equal(lock.length,1);
    const [grants]=await expert.execute<mysql.RowDataPacket[]>(
      "SELECT branch_id FROM user_branch_scopes WHERE user_id=?",[reviewer]);
    const [livePerms]=await expert.execute<mysql.RowDataPacket[]>(
      "SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id WHERE rp.role_id=?",[roleId]);
    assert.equal(grants.length,0);
    assert.ok(!livePerms.some(p=>p.code==="catalog.reference_ranges.manage"));
    await expert.commit();
    const [noDecision]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE id=?",[decision]);
    assert.equal(noDecision.length,0);

    await insert("INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[reviewer,branch]);
    await insert("INSERT INTO role_permissions(role_id,permission_id) VALUES(?,?)",[roleId,permissionIds[1]]);
    await insert("UPDATE lab_tests SET name_en='Updated' WHERE id=?",[labTest]);
    await expert.beginTransaction();
    const [relocked]=await expert.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]);
    assert.equal(relocked.length,1);
    const [scoped]=await expert.execute<mysql.RowDataPacket[]>(
      "SELECT t.id,t.code,t.name_en FROM lab_tests t JOIN user_department_scopes d ON d.department_id=t.department_id JOIN user_branch_scopes b ON b.branch_id=? WHERE t.id=? AND t.organization_id=? AND d.user_id=? AND b.user_id=?",
      [branch,labTest,org,reviewer,reviewer]);
    assert.equal(scoped.length,1);
    const live={id:String(scoped[0].id),code:String(scoped[0].code),nameEn:String(scoped[0].name_en)};
    const now=catalogDriftObservationToken(secret,"a".repeat(64),1,"TEST",source,live);
    const permissions=new Set(["catalog.manage","catalog.reference_ranges.manage"]);
    assert.deepEqual(expertDispositionAllowed({
      expertUserId:reviewer,batchAuthorId:author,flagActorUserId:author,
      eventCategory:"CLINICAL",entityType:"TEST",flaggedEvidence:originalToken,
      latestEvidence:now,sessionPermissions:permissions,livePermissions:permissions,
      isLatestFlag:true,isOpenDraft:true,
    }),{allowed:false,reason:"expert_evidence_stale"});
    const [foreign]=await expert.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE organization_id=? AND id=?",[org,foreignTest]);
    assert.equal(foreign.length,0);
    await expert.rollback();
    await insert("UPDATE lab_tests SET name_en='Before' WHERE id=?",[labTest]);
    assert.equal(expertDispositionAllowed({
      expertUserId:reviewer,batchAuthorId:author,flagActorUserId:author,
      eventCategory:"CLINICAL",entityType:"TEST",flaggedEvidence:originalToken,
      latestEvidence:originalToken,sessionPermissions:permissions,livePermissions:permissions,
      isLatestFlag:true,isOpenDraft:true,
    }).allowed,true);
    await expert.beginTransaction();
    const [finalLock]=await expert.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]);
    assert.equal(finalLock.length,1);
    await expert.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_EXPERT_DECISION_RECORDED','CatalogExpertReviewFlag',?,?)",
      [decision,org,branch,reviewer,flag,JSON.stringify({
        batchId:batch,rowId:row,category:"CLINICAL",disposition:"RETURN_FOR_CORRECTION",
        evidenceToken:originalToken,reviewOnly:true,approved:false,activated:false,
      })]);
    await expert.commit();
    const [saved]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT actor_user_id,entity_id,new_values FROM audit_events WHERE id=?",[decision]);
    assert.equal(saved.length,1);
    assert.equal(saved[0].actor_user_id,reviewer);
    assert.equal(saved[0].entity_id,flag);
    const evidence=typeof saved[0].new_values==="string"?
      JSON.parse(saved[0].new_values):saved[0].new_values;
    assert.equal(evidence.approved,false);
    assert.equal(evidence.activated,false);
    const [preserved]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT name_en FROM lab_tests WHERE id=?",[labTest]);
    assert.equal(preserved[0].name_en,"Before");
  }finally{
    await writer.rollback().catch(()=>{});
    await expert.rollback().catch(()=>{});
    await insert("DELETE FROM audit_events WHERE id IN (?,?)",[decision,flag]).catch(()=>{});
    await insert("DELETE FROM catalog_import_rows WHERE id=?",[row]).catch(()=>{});
    await insert("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await insert("DELETE FROM role_permissions WHERE role_id=?",[roleId]).catch(()=>{});
    await insert("DELETE FROM user_roles WHERE user_id=?",[reviewer]).catch(()=>{});
    await insert("DELETE FROM roles WHERE id=?",[roleId]).catch(()=>{});
    await insert("DELETE FROM user_department_scopes WHERE user_id=?",[reviewer]).catch(()=>{});
    await insert("DELETE FROM user_branch_scopes WHERE user_id=?",[reviewer]).catch(()=>{});
    await insert("DELETE FROM lab_tests WHERE id IN (?,?)",[labTest,foreignTest]).catch(()=>{});
    await insert("DELETE FROM departments WHERE id=?",[dept]).catch(()=>{});
    await insert("DELETE FROM users WHERE id IN (?,?)",[author,reviewer]).catch(()=>{});
    await insert("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await insert("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    for(const id of createdPermissions)
      await insert("DELETE FROM permissions WHERE id=?",[id]).catch(()=>{});
    await Promise.all([writer.end(),expert.end()]);
  }
});
