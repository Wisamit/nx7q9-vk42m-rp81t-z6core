import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { createPolicyDraftLedgerEntry, policyKeys,
  type CatalogPolicyProposal } from "../src/lib/catalog-signatory-policy-draft.ts";
import { nextPolicyReviewRecord } from "../src/lib/catalog-policy-draft-review.ts";
import { policyDraftAuthorFeedback } from "../src/lib/catalog-policy-feedback.ts";

test("Stage 62 MariaDB: author sees current revision only, preserving independent review history",{
  timeout:45000,
},async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),outside=randomUUID(),branch=randomUUID(),batch=randomUUID();
  const author=randomUUID(),clinical=randomUUID(),financial=randomUUID();
  const firstId=randomUUID(),nextId=randomUUID(),clinicalId=randomUUID(),financeId=randomUUID(),badId=randomUUID();
  const prefix="S62"+org.slice(0,8),checksum="f".repeat(64);
  const ctx={organizationId:org,branchId:branch,batchId:batch,sourceChecksum:checksum};
  const proposal=Object.fromEntries(policyKeys.map(key=>[key,"UNDECIDED"])) as CatalogPolicyProposal;
  const v1=createPolicyDraftLedgerEntry(ctx,proposal,1);
  const v2=createPolicyDraftLedgerEntry(ctx,{...proposal,financialAuthority:"FINANCE_DIRECTOR"},2);
  const exec=(sql:string,params:(string|number|null)[])=>writer.execute(sql,params);
  const decode=(v:unknown)=>typeof v==="string"?JSON.parse(v):v;
  const load=async(eventId:string,draft:typeof v1)=>{
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT actor_user_id,new_values FROM audit_events WHERE organization_id=? AND branch_id=? AND entity_type='CatalogPolicyDraft' AND action='CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED' AND entity_id=? LIMIT 3",
      [org,branch,eventId]);
    return policyDraftAuthorFeedback({draftEventId:eventId,draft,authorUserId:author,
      events:rows.map(row=>({actorUserId:row.actor_user_id,
        newValues:decode(row.new_values)}))});
  };
  try{
    for(const [id,code] of [[org,"A"],[outside,"X"]])
      await exec("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+code,"Stage62 Organization"]);
    await exec("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,prefix+"B","Stage62 Branch"]);
    for(const [id,code] of [[author,"A"],[clinical,"C"],[financial,"F"]])
      await exec("INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
        [id,org,prefix+code,"Stage62 User"]);
    await exec("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage62.json',?,'DRAFT',?,NOW(3))",
      [batch,org,checksum,author]);
    await exec("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?)",
      [firstId,org,branch,author,batch,JSON.stringify(v1)]);
    const medical=nextPolicyReviewRecord({draftEventId:firstId,draft:v1,domain:"CLINICAL",
      disposition:"RETURN_FOR_REVISION",reasonCode:"CLINICAL_SAFETY_REVIEW_UNDEFINED"});
    const finance=nextPolicyReviewRecord({draftEventId:firstId,draft:v1,domain:"FINANCIAL",
      disposition:"NOTED_FOR_DISCUSSION",reasonCode:"NO_FURTHER_OBJECTION_TO_DISCUSSION"});
    await writer.beginTransaction();
    const [lock]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(lock.length,1);
    for(const [id,actor,review] of [[clinicalId,clinical,medical],[financeId,financial,finance]] as const)
      await writer.execute(
        "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED','CatalogPolicyDraft',?,?)",
        [id,org,branch,actor,firstId,JSON.stringify(review)]);
    await writer.commit();
    const feedback=await load(firstId,v1);
    assert.equal(feedback?.domains.CLINICAL.status,"RETURN_FOR_REVISION");
    assert.equal(feedback?.domains.FINANCIAL.status,"NOTED_FOR_DISCUSSION");
    assert.equal(feedback?.approved,false);
    await exec(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,DATE_ADD(NOW(3),INTERVAL 1 SECOND))",
      [nextId,org,branch,author,batch,JSON.stringify(v2)]);
    const [latest]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE organization_id=? AND entity_id=? AND action='CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED' ORDER BY occurred_at DESC,id DESC LIMIT 1",[org,batch]);
    assert.equal(latest[0].id,nextId);
    const fresh=await load(nextId,v2);
    assert.equal(fresh?.domains.CLINICAL.status,"PENDING");
    assert.equal(fresh?.domains.FINANCIAL.status,"PENDING");
    const historical=await load(firstId,v1);
    assert.equal(historical?.domains.CLINICAL.status,"RETURN_FOR_REVISION");
    const [foreign]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE organization_id=? AND entity_id=?",[outside,firstId]);
    assert.equal(foreign.length,0);
    await exec(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED','CatalogPolicyDraft',?,?)",
      [badId,org,branch,author,nextId,JSON.stringify({...finance,draftEventId:nextId,revision:2,proposalDigest:v2.proposalDigest})]);
    assert.equal(await load(nextId,v2),null);
    const [unchanged]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(unchanged[0].n),0);
  }finally{
    await writer.rollback().catch(()=>{});
    await reader.rollback().catch(()=>{});
    await exec("DELETE FROM audit_events WHERE id IN (?,?,?,?,?)",
      [badId,financeId,clinicalId,nextId,firstId]).catch(()=>{});
    await exec("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await exec("DELETE FROM users WHERE id IN (?,?,?)",[author,clinical,financial]).catch(()=>{});
    await exec("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await exec("DELETE FROM organizations WHERE id IN (?,?)",[org,outside]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
