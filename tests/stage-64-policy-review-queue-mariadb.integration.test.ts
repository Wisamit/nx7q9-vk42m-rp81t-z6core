import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { verifiedPolicyQueueCandidate } from "../src/lib/catalog-policy-review-queue-guard.ts";
import { policyReviewIdentityScope } from "../src/lib/catalog-policy-review-scope.ts";
import {
  createPolicyDraftLedgerEntry, policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";

test("Stage 64 MariaDB: queue candidate is hidden on rogue audit and live branch/department drift",{
  timeout:45000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branchA=randomUUID(),branchB=randomUUID();
  const deptA=randomUUID(),deptB=randomUUID(),testId=randomUUID(),batch=randomUUID();
  const author=randomUUID(),rogue=randomUUID(),rowId=randomUUID(),auditOne=randomUUID(),auditTwo=randomUUID();
  const code="S64"+org.slice(0,8),sourceChecksum="b".repeat(64);
  const policyScope={organizationId:org,branchId:branchA,batchId:batch,sourceChecksum};
  const proposal=Object.fromEntries(policyKeys.map(key=>[key,"UNDECIDED"])) as CatalogPolicyProposal;
  const first=createPolicyDraftLedgerEntry(policyScope,proposal,1);
  const second=createPolicyDraftLedgerEntry(policyScope,{
    ...proposal,branchDelegation:"BRANCH_SPECIFIC",
  },2);
  const write=(sql:string,params:Array<string|number|null>)=>writer.execute(sql,params);
  const json=(value:unknown)=>typeof value==="string"?JSON.parse(value):value;
  const history=async(candidateEventId:string)=>{
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,actor_user_id,branch_id,new_values FROM audit_events WHERE organization_id=? AND action='CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED' AND entity_type='CatalogImportBatch' AND entity_id=? ORDER BY occurred_at DESC,id DESC LIMIT 1001",
      [org,batch]);
    return verifiedPolicyQueueCandidate({
      ...policyScope,authorUserId:author,candidateEventId,
      events:rows.map(row=>({
        id:String(row.id),actorUserId:row.actor_user_id as string|null,
        branchId:row.branch_id as string|null,
        newValues:json(row.new_values),
      })),
    });
  };
  try{
    for(const [id,suffix] of [[org,"O"],[foreignOrg,"X"]])
      await write("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,code+suffix,"Stage64"]);
    for(const [id,suffix] of [[branchA,"A"],[branchB,"B"]])
      await write("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,code+suffix,"Stage64 Branch"]);
    for(const [id,branch,suffix] of [[deptA,branchA,"D"],[deptB,branchB,"E"]])
      await write("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,org,branch,code+suffix,"Stage64 Department"]);
    await write("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [testId,org,deptA,code+"T","Stage64 Test"]);
    for(const [id,suffix] of [[author,"A"],[rogue,"R"]])
      await write("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,code+suffix,"Stage64 User"]);
    await write(
      "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage64.json',?,'DRAFT',?,NOW(3))",
      [batch,org,sourceChecksum,author]);
    await write(
      "INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,legacy_key,source_data,normalized_data,validation_issues,updated_at) VALUES(?,?,1,'TEST','WARNING',?,?,?,?,NOW(3))",
      [rowId,batch,testId,
        JSON.stringify({id:testId,code:code+"T",nameEn:"Stage64 Test",departmentId:deptA,status:"ACTIVE"}),
        JSON.stringify({id:testId,code:code+"T",nameEn:"Stage64 Test",departmentId:deptA,status:"ACTIVE"}),
        JSON.stringify([{severity:"WARNING",code:"REVIEW_ONLY"}])]);
    await writer.beginTransaction();
    const [locked]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(locked.length,1);
    await writer.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?)",
      [auditOne,org,branchA,author,batch,JSON.stringify(first)]);
    await writer.commit();
    assert.equal((await history(auditOne))?.revisionCount,1);
    const [staged]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT entity_type AS entityType,status,imported_entity_id AS importedEntityId,source_data AS sourceData,normalized_data AS normalizedData FROM catalog_import_rows WHERE batch_id=?",[batch]);
    const identities=staged.map(row=>({
      entityType:String(row.entityType),status:String(row.status),
      importedEntityId:row.importedEntityId as string|null,
      sourceData:json(row.sourceData),normalizedData:json(row.normalizedData),
    }));
    assert.equal(policyReviewIdentityScope(identities,new Set([branchA])).ok,true);
    // A TEST has no explicit branchId in its serialized master identity:
    // only the live department/branch join below can reject its relocation.
    assert.equal(policyReviewIdentityScope(identities,new Set()).ok,true);
    const [scoped]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT t.id FROM lab_tests t JOIN departments d ON d.id=t.department_id WHERE t.organization_id=? AND t.id=? AND d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?)",
      [org,testId,branchA]);
    assert.equal(scoped.length,1);
    await write("UPDATE lab_tests SET department_id=?,updated_at=NOW(3) WHERE id=?",
      [deptB,testId]);
    const [revoked]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT t.id FROM lab_tests t JOIN departments d ON d.id=t.department_id WHERE t.organization_id=? AND t.id=? AND d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?)",
      [org,testId,branchA]);
    assert.equal(revoked.length,0);

    await write(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,DATE_ADD(NOW(3),INTERVAL 1 SECOND))",
      [auditTwo,org,branchA,rogue,batch,JSON.stringify(second)]);
    assert.equal(await history(auditOne),null);
    assert.equal(await history(auditTwo),null);
    const [foreign]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE organization_id=? AND entity_id=?",[foreignOrg,batch]);
    assert.equal(foreign.length,0);
    const [unchanged]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM catalog_import_rows WHERE batch_id=? AND imported_entity_id IS NOT NULL",[batch]);
    assert.equal(Number(unchanged[0].n),0);
  } finally{
    await writer.rollback().catch(()=>{});
    await reader.rollback().catch(()=>{});
    await write("DELETE FROM audit_events WHERE id IN (?,?)",[auditOne,auditTwo]).catch(()=>{});
    await write("DELETE FROM catalog_import_rows WHERE id=?",[rowId]).catch(()=>{});
    await write("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await write("DELETE FROM lab_tests WHERE id=?",[testId]).catch(()=>{});
    await write("DELETE FROM departments WHERE id IN (?,?)",[deptA,deptB]).catch(()=>{});
    await write("DELETE FROM users WHERE id IN (?,?)",[author,rogue]).catch(()=>{});
    await write("DELETE FROM branches WHERE id IN (?,?)",[branchA,branchB]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
