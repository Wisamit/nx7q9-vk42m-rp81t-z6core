import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { createPolicyDraftLedgerEntry, policyKeys,
  type CatalogPolicyProposal } from "../src/lib/catalog-signatory-policy-draft.ts";
import { nextPolicyReviewRecord, parsePolicyReviewRecord } from "../src/lib/catalog-policy-draft-review.ts";

test("Stage 60 MariaDB: independent per-domain reviews bind latest immutable draft and tenant",{
  timeout:45000,
},async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)};
  const [author,reviewer]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),otherOrg=randomUUID(),branch=randomUUID();
  const authorId=randomUUID(),clinician=randomUUID(),finance=randomUUID(),foreignUser=randomUUID();
  const batch=randomUUID(),draftId=randomUUID(),clinicalId=randomUUID(),
    financialId=randomUUID(),revisedId=randomUUID();
  const prefix="S60"+org.slice(0,8);
  const ctx={organizationId:org,branchId:branch,batchId:batch,sourceChecksum:"c".repeat(64)};
  const firstProposal=Object.fromEntries(policyKeys.map(key=>[key,"UNDECIDED"])) as CatalogPolicyProposal;
  const revisedProposal={...firstProposal,financialAuthority:"FINANCE_DIRECTOR"} as CatalogPolicyProposal;
  const draft=createPolicyDraftLedgerEntry(ctx,firstProposal,1);
  const write=(sql:string,params:Array<string|number|null>)=>author.execute(sql,params);
  try{
    for(const [id,suffix] of [[org,"A"],[otherOrg,"F"]])
      await write("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+suffix,"Stage60 Organization"]);
    await write("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,prefix+"B","Stage60 Branch"]);
    for(const [id,tenant,suffix] of [
      [authorId,org,"A"],[clinician,org,"C"],[finance,org,"P"],[foreignUser,otherOrg,"F"],
    ]) await write("INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
      [id,tenant,prefix+suffix,"Stage60 User"]);
    await write("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage60.json',?,'DRAFT',?,NOW(3))",
      [batch,org,ctx.sourceChecksum,authorId]);
    await write("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?)",
      [draftId,org,branch,authorId,batch,JSON.stringify(draft)]);

    const first=nextPolicyReviewRecord({
      draftEventId:draftId,draft,domain:"CLINICAL",disposition:"RETURN_FOR_REVISION",
      reasonCode:"CLINICAL_SAFETY_REVIEW_UNDEFINED",
    });
    const second=nextPolicyReviewRecord({
      draftEventId:draftId,draft,domain:"FINANCIAL",disposition:"NOTED_FOR_DISCUSSION",
      reasonCode:"NO_FURTHER_OBJECTION_TO_DISCUSSION",
    });
    await author.beginTransaction();
    const [tenantLock]=await author.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(tenantLock.length,1);
    await author.execute("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED','CatalogPolicyDraft',?,?)",
      [clinicalId,org,branch,clinician,draftId,JSON.stringify(first)]);
    await author.commit();
    await reviewer.beginTransaction();
    const [snapshotLock]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(snapshotLock.length,1);
    const [recorded]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT actor_user_id,new_values FROM audit_events WHERE entity_id=? AND organization_id=? AND action='CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED'",
      [draftId,org]);
    assert.equal(recorded.length,1);
    const saved=typeof recorded[0].new_values==="string"
      ? JSON.parse(recorded[0].new_values) : recorded[0].new_values;
    assert.deepEqual(parsePolicyReviewRecord(saved,{draftEventId:draftId,draft}),first);
    assert.equal(recorded[0].actor_user_id,clinician);
    assert.notEqual(recorded[0].actor_user_id,finance);
    assert.equal(saved.approved,false);
    assert.equal(saved.activated,false);
    await reviewer.commit();

    await write("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED','CatalogPolicyDraft',?,?)",
      [financialId,org,branch,finance,draftId,JSON.stringify(second)]);
    const [both]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT actor_user_id,new_values FROM audit_events WHERE organization_id=? AND entity_id=? AND action='CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED'",
      [org,draftId]);
    assert.equal(both.length,2);
    const actual=both.map(row=>({
      actor:String(row.actor_user_id),
      review:parsePolicyReviewRecord(
        typeof row.new_values==="string"?JSON.parse(row.new_values):row.new_values,
        {draftEventId:draftId,draft}),
    }));
    assert.ok(actual.every(x=>x.review?.approved===false && x.review?.liveWrites===false));
    assert.equal(new Set(actual.map(x=>x.actor)).size,2);
    assert.equal(new Set(actual.map(x=>x.review?.domain)).size,2);
    assert.ok(!actual.some(x=>x.actor===authorId));

    const version2=createPolicyDraftLedgerEntry(ctx,revisedProposal,2);
    await write("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,DATE_ADD(NOW(3), INTERVAL 1 SECOND))",
      [revisedId,org,branch,authorId,batch,JSON.stringify(version2)]);
    const [latest]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE organization_id=? AND branch_id=? AND entity_id=? AND action='CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED' ORDER BY occurred_at DESC,id DESC LIMIT 1",
      [org,branch,batch]);
    assert.equal(latest[0].id,revisedId);
    assert.notEqual(latest[0].id,draftId);
    assert.equal(parsePolicyReviewRecord(first,{draftEventId:draftId,draft:version2}),null);
    const [historical]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_events WHERE organization_id=? AND entity_id=? AND action='CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED'",
      [org,draftId]);
    assert.equal(Number(historical[0].n),2);
    const [foreignVisible]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE entity_id=? AND organization_id=?",[draftId,otherOrg]);
    assert.equal(foreignVisible.length,0);
    const [clinicalMaster]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(clinicalMaster[0].n),0);
  }finally{
    await author.rollback().catch(()=>{});
    await reviewer.rollback().catch(()=>{});
    await write("DELETE FROM audit_events WHERE id IN (?,?,?,?)",
      [financialId,clinicalId,revisedId,draftId]).catch(()=>{});
    await write("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await write("DELETE FROM users WHERE id IN (?,?,?,?)",
      [authorId,clinician,finance,foreignUser]).catch(()=>{});
    await write("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id IN (?,?)",[org,otherOrg]).catch(()=>{});
    await Promise.all([author.end(),reviewer.end()]);
  }
});
