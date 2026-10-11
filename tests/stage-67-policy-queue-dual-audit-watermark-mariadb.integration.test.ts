import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  issueSignedPolicyQueueCursor, verifySignedPolicyQueueCursor,
  samePolicyQueueAnchor, samePolicyQueueAuditWatermark,
  POLICY_QUEUE_CURSOR_TTL_MS, type PolicyQueueAuditWatermark,
} from "../src/lib/catalog-policy-queue-signed-cursor.ts";
import {
  createPolicyDraftLedgerEntry, policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";
import { nextPolicyReviewRecord } from "../src/lib/catalog-policy-draft-review.ts";

test("Stage 67 MariaDB: draft and review AuditEvent counts invalidate cursor on backdated/same-ms changes", {
  timeout:60000,
}, async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),outside=randomUUID(),branch=randomUUID(),otherBranch=randomUUID();
  const author=randomUUID(),clinical=randomUUID(),finance=randomUUID(),batch=randomUUID();
  const draftId="fffffff1-ffff-4fff-8fff-ffffffffffff";
  const revisedId="00000001-0000-4000-8000-000000000001";
  const clinicalId=randomUUID(),financeId=randomUUID();
  const prefix="S67"+org.slice(0,8),checksum="7".repeat(64);
  const input={organizationId:org,branchId:branch,batchId:batch,sourceChecksum:checksum};
  const proposal=Object.fromEntries(policyKeys.map(k=>[k,"UNDECIDED"])) as CatalogPolicyProposal;
  const v1=createPolicyDraftLedgerEntry(input,proposal,1);
  const v2=createPolicyDraftLedgerEntry(input,{...proposal,branchDelegation:"BRANCH_SPECIFIC"},2);
  const scope={organizationId:org,branchId:branch,reviewerUserId:clinical,
    secret:"stage-67-only-MariaDB-test-secret".repeat(2)};
  const write=(sql:string,values:Array<string|number|null>)=>writer.execute(sql,values);
  const current=async(action:string,entityType:string):Promise<PolicyQueueAuditWatermark>=>{
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,occurred_at FROM audit_events WHERE organization_id=? AND branch_id=? AND action=? AND entity_type=? ORDER BY occurred_at DESC,id DESC LIMIT 1",
      [org,branch,action,entityType]);
    const [counts]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_events WHERE organization_id=? AND branch_id=? AND action=? AND entity_type=?",
      [org,branch,action,entityType]);
    return {latest:rows.length?{id:String(rows[0].id),occurredAt:new Date(rows[0].occurred_at)}:null,
      count:Number(counts[0].n)};
  };
  const draft=()=>current("CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED","CatalogImportBatch");
  const review=()=>current("CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED","CatalogPolicyDraft");
  try{
    for(const [id,s] of [[org,"O"],[outside,"X"]])
      await write("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+s,"Stage67 Organization"]);
    for(const [id,s] of [[branch,"A"],[otherBranch,"B"]])
      await write("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+s,"Stage67 Branch"]);
    for(const [id,s] of [[author,"A"],[clinical,"C"],[finance,"F"]])
      await write("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+s,"Stage67 User"]);
    await write("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage67.json',?,'DRAFT',?,NOW(3))",
      [batch,org,checksum,author]);
    await writer.beginTransaction();
    const [lock]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(lock.length,1);
    await writer.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,?)",
      [draftId,org,branch,author,batch,JSON.stringify(v1),"2026-10-11 12:00:00.123"]);
    await writer.commit();
    const initialDraft=await draft(),initialReview=await review();
    assert.equal(initialDraft.count,1);
    assert.equal(initialReview.count,0);
    assert.ok(initialDraft.latest);
    const now=Date.now(),token=issueSignedPolicyQueueCursor({...scope,
      anchor:initialDraft.latest,after:initialDraft.latest,
      draftCount:initialDraft.count,reviewWatermark:initialReview,
      expiresAt:now+POLICY_QUEUE_CURSOR_TTL_MS});
    const verified=verifySignedPolicyQueueCursor(token,scope,now);
    assert.ok(verified);
    assert.equal(samePolicyQueueAnchor(verified.anchor,(await draft()).latest),true);

    // Clinical comment changes queue eligibility without any draft revision.
    const clinicalDecision=nextPolicyReviewRecord({
      draftEventId:draftId,draft:v1,domain:"CLINICAL",
      disposition:"RETURN_FOR_REVISION",reasonCode:"CLINICAL_AUTHORITY_UNCLEAR",
    });
    await write(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED','CatalogPolicyDraft',?,?,?)",
      [clinicalId,org,branch,clinical,draftId,JSON.stringify(clinicalDecision),"2026-10-11 12:00:00.123"]);
    const firstReview=await review();
    assert.equal(firstReview.count,1);
    assert.equal(samePolicyQueueAuditWatermark(verified.reviewWatermark,firstReview),false);
    assert.equal(samePolicyQueueAnchor(verified.anchor,(await draft()).latest),true);
    const resumed=issueSignedPolicyQueueCursor({...scope,
      anchor:initialDraft.latest,after:initialDraft.latest,
      draftCount:initialDraft.count,reviewWatermark:firstReview,
      expiresAt:now+POLICY_QUEUE_CURSOR_TTL_MS});

    // A valid *other domain* review is deliberately backdated. The latest
    // review event remains unchanged, but the count changes from 1 to 2.
    const financialDecision=nextPolicyReviewRecord({
      draftEventId:draftId,draft:v1,domain:"FINANCIAL",
      disposition:"NOTED_FOR_DISCUSSION",reasonCode:"NO_FURTHER_OBJECTION_TO_DISCUSSION",
    });
    await write(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED','CatalogPolicyDraft',?,?,?)",
      [financeId,org,branch,finance,draftId,JSON.stringify(financialDecision),"2026-10-11 11:00:00.123"]);
    const secondReview=await review();
    assert.equal(secondReview.count,2);
    assert.deepEqual(secondReview.latest,firstReview.latest);
    const lastReviewToken=verifySignedPolicyQueueCursor(resumed,scope,now);
    assert.ok(lastReviewToken);
    assert.equal(samePolicyQueueAuditWatermark(lastReviewToken.reviewWatermark,secondReview),false);

    // Same-ms lower UUID new revision does not change maximum sort position:
    // the count must still invalidate the previous draft watermark.
    await write(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,?)",
      [revisedId,org,branch,author,batch,JSON.stringify(v2),"2026-10-11 12:00:00.123"]);
    const laterDraft=await draft();
    assert.equal(laterDraft.count,2);
    assert.deepEqual(laterDraft.latest,initialDraft.latest);
    assert.notEqual(laterDraft.count,verified.draftCount);
    const [foreign]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_events WHERE organization_id=? AND branch_id=?",
      [outside,branch]);
    assert.equal(Number(foreign[0].n),0);
    const [notApplied]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM catalog_import_rows WHERE batch_id=?",[batch]);
    assert.equal(Number(notApplied[0].n),0);
    const [masters]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(masters[0].n),0);
  }finally{
    await writer.rollback().catch(()=>{});
    await reader.rollback().catch(()=>{});
    await write("DELETE FROM audit_events WHERE id IN (?,?,?,?)",
      [draftId,revisedId,clinicalId,financeId]).catch(()=>{});
    await write("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await write("DELETE FROM users WHERE id IN (?,?,?)",[author,clinical,finance]).catch(()=>{});
    await write("DELETE FROM branches WHERE id IN (?,?)",[branch,otherBranch]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id IN (?,?)",[org,outside]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
