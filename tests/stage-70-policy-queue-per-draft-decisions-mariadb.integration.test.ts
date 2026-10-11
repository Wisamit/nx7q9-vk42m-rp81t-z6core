import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { planPolicyQueueDecisionFetch } from "../src/lib/catalog-policy-queue-decision-plan.ts";
import {
  createPolicyDraftLedgerEntry, policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";
import {
  nextPolicyReviewRecord, parsePolicyReviewRecord,
} from "../src/lib/catalog-policy-draft-review.ts";

test("Stage 70 MariaDB: 200+ decisions across drafts coexist; malformed drafts are hidden individually",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([
    mysql.createConnection(config),mysql.createConnection(config),
  ]);
  const org=randomUUID(),outside=randomUUID(),branch=randomUUID(),otherBranch=randomUUID();
  const author=randomUUID(),clinical=randomUUID(),financial=randomUUID();
  const code="S70"+org.slice(0,8),checksum="d".repeat(64);
  const proposal=Object.fromEntries(policyKeys.map(k=>[k,"UNDECIDED"])) as CatalogPolicyProposal;
  const drafts=Array.from({length:105},()=>({
    draftEventId:randomUUID(), batchId:randomUUID(),
  }));
  const decisions:Array<{
    id:string; organizationId:string;branchId:string;actorUserId:string;
    entityId:string;newValues:unknown;
  }>=[];
  const pushDecision=(index:number, domain:"CLINICAL"|"FINANCIAL",
    branchId=branch, actor=domain==="CLINICAL"?clinical:financial,
    reasonCode=domain==="CLINICAL"?"CLINICAL_AUTHORITY_UNCLEAR":"FINANCIAL_AUTHORITY_UNCLEAR")=>{
    const item=drafts[index];
    const scope={organizationId:org,branchId:branch,batchId:item.batchId,
      sourceChecksum:checksum};
    const draft=createPolicyDraftLedgerEntry(scope,proposal,1);
    decisions.push({id:randomUUID(),organizationId:org,branchId,
      actorUserId:actor,entityId:item.draftEventId,
      newValues:nextPolicyReviewRecord({draftEventId:item.draftEventId,draft,
        domain,disposition:"RETURN_FOR_REVISION",reasonCode,
      })});
  };
  for(let i=0;i<100;i++){
    pushDecision(i,"CLINICAL");
    pushDecision(i,"FINANCIAL");
  }
  // 100 valid 2-decision drafts; index 100 remains eligible with zero reviews.
  pushDecision(101,"CLINICAL");
  pushDecision(101,"FINANCIAL");
  pushDecision(101,"CLINICAL",branch,author);
  pushDecision(102,"CLINICAL",otherBranch);
  pushDecision(103,"FINANCIAL",branch,author);
  pushDecision(104,"CLINICAL");
  pushDecision(104,"CLINICAL");
  // An otherwise matching id belonging to a different tenant is never counted.
  decisions.push({...decisions[0],id:randomUUID(),organizationId:outside,
    branchId:otherBranch,entityId:drafts[100].draftEventId});
  const put=(sql:string,params:Array<string|number|null>)=>writer.execute(sql,params);
  try{
    for(const [id,suffix] of [[org,"O"],[outside,"X"]])
      await put("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,code+suffix,"Stage70 Org"]);
    for(const [id,suffix] of [[branch,"B"],[otherBranch,"C"]])
      await put("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,code+suffix,"Stage70 Branch"]);
    for(const [id,suffix] of [[author,"A"],[clinical,"L"],[financial,"F"]])
      await put("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,code+suffix,"Stage70 Actor"]);
    // An external-tenant event does not get a foreign branch: the org
    // predicate is the isolation boundary for policy review audit readers.
    for(const sliceStart of Array.from({length:Math.ceil(decisions.length/60)},(_,i)=>i*60)){
      const part=decisions.slice(sliceStart,sliceStart+60);
      const sql="INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES "+
        part.map(()=>"(?,?,?,?,'CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED','CatalogPolicyDraft',?,?,NOW(3))").join(",");
      await writer.execute(sql,part.flatMap(x=>[x.id,x.organizationId,x.branchId,
        x.actorUserId,x.entityId,JSON.stringify(x.newValues)]));
    }
    const ids=drafts.map(x=>x.draftEventId);
    const placeholders=ids.map(()=>"?").join(",");
    const [counts]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT entity_id AS entityId,COUNT(*) AS n FROM audit_events "+
      "WHERE organization_id=? AND action='CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED' "+
      "AND entity_type='CatalogPolicyDraft' AND entity_id IN ("+placeholders+") "+
      "GROUP BY entity_id",
      [org,...ids]);
    const plan=planPolicyQueueDecisionFetch(ids,counts.map(x=>({
      entityId:String(x.entityId),_count:{_all:Number(x.n)},
    })));
    assert.ok(plan);
    assert.equal(decisions.length,208);
    assert.equal(plan.expectedCounts.get(drafts[100].draftEventId),undefined);
    assert.equal(plan.corruptDraftIds.size,1);
    assert.equal(plan.corruptDraftIds.has(drafts[101].draftEventId),true);
    assert.equal(plan.safeDraftIds.length,104);
    assert.equal(plan.maxRows,209);
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT entity_id,branch_id,actor_user_id,new_values FROM audit_events "+
      "WHERE organization_id=? AND action='CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED' "+
      "AND entity_type='CatalogPolicyDraft' AND entity_id IN ("+
      plan.safeDraftIds.map(()=>"?").join(",")+") LIMIT "+plan.maxRows,
      [org,...plan.safeDraftIds]);
    assert.equal(rows.length,204);
    const grouped=new Map<string,mysql.RowDataPacket[]>();
    for(const row of rows){
      const key=String(row.entity_id);
      grouped.set(key,[...(grouped.get(key)||[]),row]);
    }
    for(let i=0;i<100;i++){
      const item=drafts[i],d=createPolicyDraftLedgerEntry({
        organizationId:org,branchId:branch,batchId:item.batchId,sourceChecksum:checksum,
      },proposal,1);
      const relevant=grouped.get(item.draftEventId)||[];
      assert.equal(relevant.length,2);
      const parsed=relevant.map(row=>parsePolicyReviewRecord(
        typeof row.new_values==="string"?JSON.parse(row.new_values):row.new_values,
        {draftEventId:item.draftEventId,draft:d},
      ));
      assert.ok(parsed.every(Boolean));
      assert.deepEqual(new Set(parsed.map(x=>x?.domain)),new Set(["CLINICAL","FINANCIAL"]));
      assert.ok(relevant.every(x=>x.branch_id===branch));
    }
    assert.equal((grouped.get(drafts[100].draftEventId)||[]).length,0);
    assert.equal((grouped.get(drafts[101].draftEventId)||[]).length,0);
    assert.equal(grouped.get(drafts[102].draftEventId)?.[0].branch_id,otherBranch);
    assert.equal(grouped.get(drafts[103].draftEventId)?.[0].actor_user_id,author);
    assert.equal(new Set((grouped.get(drafts[104].draftEventId)||[])
      .map(x=>x.actor_user_id)).size,1);
    const [master]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(master[0].n),0);
    const [staged]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM catalog_import_batches WHERE organization_id=?",[org]);
    assert.equal(Number(staged[0].n),0);
  }finally{
    await writer.rollback().catch(()=>{});
    await reader.rollback().catch(()=>{});
    await put("DELETE FROM audit_events WHERE organization_id IN (?,?) AND action='CATALOG_BUNDLE_POLICY_DRAFT_REVIEW_RECORDED' AND entity_type='CatalogPolicyDraft'",
      [org,outside]).catch(()=>{});
    await put("DELETE FROM users WHERE id IN (?,?,?)",[author,clinical,financial]).catch(()=>{});
    await put("DELETE FROM branches WHERE id IN (?,?)",[branch,otherBranch]).catch(()=>{});
    await put("DELETE FROM organizations WHERE id IN (?,?)",[org,outside]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
