import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  verifyBranchScopedPolicyDraftHistory,policyAuditBranchesMatch,
} from "../src/lib/catalog-policy-draft-history.ts";
import { verifiedPolicyQueueCandidate } from "../src/lib/catalog-policy-review-queue-guard.ts";
import {
  createPolicyDraftLedgerEntry,policyKeys,type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";
import { nextPolicyReviewRecord } from "../src/lib/catalog-policy-draft-review.ts";

test("Stage 69 MariaDB: tenant-wide audit lookup rejects wrong-branch revision and review while preserving other organizations",{
  timeout:45000,
},async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),outside=randomUUID(),a=randomUUID(),b=randomUUID(),author=randomUUID();
  const reviewer=randomUUID(),batch=randomUUID(),eventOne=randomUUID(),
    eventTwo=randomUUID(),reviewOne=randomUUID(),reviewTwo=randomUUID(),externalEvent=randomUUID();
  const code="S69"+org.slice(0,8);
  const ctx={organizationId:org,branchId:a,batchId:batch,
    authorUserId:author,sourceChecksum:"6".repeat(64)};
  const proposal=Object.fromEntries(policyKeys.map(key=>[key,"UNDECIDED"])) as CatalogPolicyProposal;
  const first=createPolicyDraftLedgerEntry(ctx,proposal,1);
  const second=createPolicyDraftLedgerEntry(ctx,{...proposal,branchDelegation:"BRANCH_SPECIFIC"},2);
  const put=(query:string,args:(string|number|null)[])=>writer.execute(query,args);
  const parse=(v:unknown)=>typeof v==="string"?JSON.parse(v):v;
  const history=async()=>{
    const [result]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,actor_user_id,branch_id,new_values FROM audit_events WHERE organization_id=? AND entity_type='CatalogImportBatch' AND action='CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED' AND entity_id=? ORDER BY occurred_at DESC,id DESC LIMIT 1001",
      [org,batch]);
    return result.map(x=>({id:String(x.id),actorUserId:x.actor_user_id as string|null,
      branchId:x.branch_id as string|null,newValues:parse(x.new_values)}));
  };
  const reviews=async()=>{
    const [result]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT branch_id FROM audit_events WHERE organization_id=? AND entity_type='CatalogPolicyDraft' AND action='CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED' AND entity_id=? LIMIT 3",
      [org,eventOne]);
    return result.map(x=>({branchId:x.branch_id as string|null}));
  };
  const addAudit=async(id:string,organizationId:string,branchId:string,actor:string,
    action:string,entityType:string,entityId:string,data:unknown,when:string)=>{
    await put(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)",
      [id,organizationId,branchId,actor,action,entityType,entityId,JSON.stringify(data),when]);
  };
  try{
    for(const [id,c] of [[org,"O"],[outside,"X"]])
      await put("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,code+c,"Stage69 Org"]);
    for(const [id,c] of [[a,"A"],[b,"B"]])
      await put("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,code+c,"Stage69 Branch"]);
    for(const [id,c] of [[author,"U"],[reviewer,"R"]])
      await put("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,code+c,"Stage69 User"]);
    await put("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage69.json',?,'DRAFT',?,NOW(3))",
      [batch,org,ctx.sourceChecksum,author]);
    await writer.beginTransaction();
    const [locked]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(locked.length,1);
    await addAudit(eventOne,org,a,author,"CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED",
      "CatalogImportBatch",batch,first,"2026-10-11 10:00:00.100");
    await writer.commit();
    const valid=await history();
    assert.equal(verifyBranchScopedPolicyDraftHistory({...ctx,events:valid})?.revisionCount,1);
    assert.equal(verifiedPolicyQueueCandidate({...ctx,events:valid,candidateEventId:eventOne})
      ?.draft?.revision,1);

    // Wrong-branch revision retains a structurally valid ledger payload.
    // A branch-filtered query would miss this event and resurrect eventOne.
    await addAudit(eventTwo,org,b,author,"CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED",
      "CatalogImportBatch",batch,second,"2026-10-11 10:00:00.200");
    const polluted=await history();
    assert.equal(polluted.length,2);
    assert.equal(verifyBranchScopedPolicyDraftHistory({...ctx,events:polluted}),null);
    assert.equal(verifiedPolicyQueueCandidate({...ctx,events:polluted,
      candidateEventId:eventOne}),null);
    assert.equal(verifiedPolicyQueueCandidate({...ctx,events:polluted,
      candidateEventId:eventTwo}),null);

    // Foreign-branch reviewer comments on the original revision cannot
    // be hidden from independent reviewer GET, POST or author feedback.
    const clinical=nextPolicyReviewRecord({draftEventId:eventOne,draft:first,
      domain:"CLINICAL",disposition:"RETURN_FOR_REVISION",
      reasonCode:"CLINICAL_AUTHORITY_UNCLEAR"});
    await addAudit(reviewOne,org,a,reviewer,"CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED",
      "CatalogPolicyDraft",eventOne,clinical,"2026-10-11 10:00:00.300");
    assert.equal(policyAuditBranchesMatch(await reviews(),a),true);
    const finance=nextPolicyReviewRecord({draftEventId:eventOne,draft:first,
      domain:"FINANCIAL",disposition:"NOTED_FOR_DISCUSSION",
      reasonCode:"NO_FURTHER_OBJECTION_TO_DISCUSSION"});
    await addAudit(reviewTwo,org,b,reviewer,"CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED",
      "CatalogPolicyDraft",eventOne,finance,"2026-10-11 10:00:00.400");
    assert.equal(policyAuditBranchesMatch(await reviews(),a),false);

    // Foreign-organization event with same batch ID remains isolated.
    await put("INSERT INTO audit_events(id,organization_id,action,entity_type,entity_id,new_values) VALUES(? ,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?)",
      [externalEvent,outside,batch,JSON.stringify(second)]);
    assert.equal((await history()).length,2);
    const [untouched]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM catalog_import_rows WHERE batch_id=?",[batch]);
    assert.equal(Number(untouched[0].n),0);
    const [masters]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(masters[0].n),0);
  }finally{
    await writer.rollback().catch(()=>{});
    await reader.rollback().catch(()=>{});
    await put("DELETE FROM audit_events WHERE id IN (?,?,?,?,?)",
      [eventOne,eventTwo,reviewOne,reviewTwo,externalEvent]).catch(()=>{});
    await put("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await put("DELETE FROM users WHERE id IN (?,?)",[author,reviewer]).catch(()=>{});
    await put("DELETE FROM branches WHERE id IN (?,?)",[a,b]).catch(()=>{});
    await put("DELETE FROM organizations WHERE id IN (?,?)",[org,outside]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
