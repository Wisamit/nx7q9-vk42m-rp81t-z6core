import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  decodePolicyQueueCursor, encodePolicyQueueCursor, policyQueueNextPage,
  POLICY_QUEUE_EVENT_WINDOW,
} from "../src/lib/catalog-policy-queue-pagination.ts";
import { verifiedPolicyQueueCandidate } from "../src/lib/catalog-policy-review-queue-guard.ts";
import {
  createPolicyDraftLedgerEntry, policyKeys, type CatalogPolicyProposal,
} from "../src/lib/catalog-signatory-policy-draft.ts";

test("Stage 65 MariaDB: 103 audit events paginate without loss, duplicates or old-revision resurrection",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),author=randomUUID();
  const code="S65"+org.slice(0,8),sourceChecksum="f".repeat(64);
  const batchIds=Array.from({length:102},()=>randomUUID());
  const eventIds=Array.from({length:103},()=>randomUUID());
  const proposal=Object.fromEntries(policyKeys.map(k=>[k,"UNDECIDED"])) as CatalogPolicyProposal;
  const write=(sql:string,params:Array<string|number|null>)=>writer.execute(sql,params);
  const parse=(v:unknown)=>typeof v==="string"?JSON.parse(v):v;
  const scope=(batchId:string)=>({
    organizationId:org,branchId:branch,batchId,sourceChecksum,authorUserId:author,
  });
  const lookup=async(batchId:string)=>{
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,actor_user_id,branch_id,new_values FROM audit_events WHERE organization_id=? AND entity_type='CatalogImportBatch' AND action='CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED' AND entity_id=? ORDER BY occurred_at DESC,id DESC LIMIT 1001",
      [org,batchId]);
    return rows.map(row=>({id:String(row.id),actorUserId:row.actor_user_id as string|null,
      branchId:row.branch_id as string|null,
      newValues:parse(row.new_values)}));
  };
  type QueueRow = mysql.RowDataPacket & {
    id:string;entity_id:string;actor_user_id:string;new_values:unknown;occurred_at:Date;
  };
  const page=async(cursor:string|null)=>{
    const decoded=decodePolicyQueueCursor(cursor);
    assert.notEqual(decoded,undefined);
    const base = "SELECT id,entity_id,actor_user_id,new_values,occurred_at FROM audit_events WHERE organization_id=? AND branch_id=? AND action='CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED' AND entity_type='CatalogImportBatch'";
    const sql=base+(decoded ? " AND (occurred_at < ? OR (occurred_at = ? AND id < ?))" : "")+
      " ORDER BY occurred_at DESC,id DESC LIMIT 101";
    const args:Array<string|Date>=[org,branch];
    if(decoded)args.push(decoded.occurredAt,decoded.occurredAt,decoded.id);
    const [results]=await reader.execute<QueueRow[]>(sql,args);
    const window=results.slice(0,POLICY_QUEUE_EVENT_WINDOW);
    const last=window.at(-1)||null;
    const next=policyQueueNextPage({
      window:window.map(row=>({id:row.id,occurredAt:new Date(row.occurred_at)})),
      lastScanned:last?{id:last.id,occurredAt:new Date(last.occurred_at)}:null,
      overflow:results.length>POLICY_QUEUE_EVENT_WINDOW,
    });
    return {events:window,next};
  };
  try{
    for(const [id,s] of [[org,"A"],[foreignOrg,"X"]])await write(
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,code+s,"Stage65 Organization"]);
    await write("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,code+"B","Stage65 Branch"]);
    await write("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [author,org,code+"U","Stage65 Author"]);
    await writer.beginTransaction();
    const [locked]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(locked.length,1);
    for(let i=0;i<batchIds.length;i++){
      const batch=batchIds[i];
      await writer.execute(
        "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage65.json',?,'DRAFT',?,NOW(3))",
        [batch,org,sourceChecksum,author]);
      const draft=createPolicyDraftLedgerEntry(scope(batch),proposal,1);
      // One deliberately old revision is pushed behind the first 100-event page.
      const date=i===0?"2026-10-11 10:00:00.000":"2026-10-11 12:00:00.123";
      await writer.execute(
        "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,?)",
        [eventIds[i],org,branch,author,batch,JSON.stringify(draft),date]);
    }
    const draft2=createPolicyDraftLedgerEntry(scope(batchIds[0]),
      {...proposal,branchDelegation:"BRANCH_SPECIFIC"},2);
    await writer.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_SIGNATORY_POLICY_DRAFT_RECORDED','CatalogImportBatch',?,?,?)",
      [eventIds[102],org,branch,author,batchIds[0],JSON.stringify(draft2),"2026-10-11 13:00:00.123"]);
    await writer.commit();
    const first=await page(null);
    assert.equal(first.events.length,100);
    assert.equal(first.next.hasMore,true);
    assert.ok(first.next.nextCursor);
    const second=await page(first.next.nextCursor);
    assert.equal(second.events.length,3);
    assert.deepEqual(second.next,{hasMore:false,nextCursor:null});
    const combined=[...first.events,...second.events];
    assert.equal(new Set(combined.map(event=>event.id)).size,103);
    assert.equal(combined[0].id,eventIds[102]);
    assert.equal(combined[combined.length-1].id,eventIds[0]);
    const current=verifiedPolicyQueueCandidate({...scope(batchIds[0]),
      events:await lookup(batchIds[0]),candidateEventId:eventIds[102]});
    assert.equal(current?.draft?.revision,2);
    assert.equal(verifiedPolicyQueueCandidate({...scope(batchIds[0]),
      events:await lookup(batchIds[0]),candidateEventId:eventIds[0]}),null);
    const tenantCount=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_events WHERE organization_id=? AND branch_id=?",
      [foreignOrg,branch]);
    assert.equal(Number(tenantCount[0][0].n),0);
    const [noWrites]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM catalog_import_rows WHERE batch_id IN ("+
        batchIds.map(()=>"?").join(",")+")",[...batchIds]);
    assert.equal(Number(noWrites[0].n),0);
    const [noMasters]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM lab_tests WHERE organization_id=?",[org]);
    assert.equal(Number(noMasters[0].n),0);
    assert.equal(decodePolicyQueueCursor(encodePolicyQueueCursor({
      id:first.events[99].id,occurredAt:new Date(first.events[99].occurred_at),
    }))?.id,first.events[99].id);
  }finally{
    await writer.rollback().catch(()=>{});
    await reader.rollback().catch(()=>{});
    await write("DELETE FROM audit_events WHERE organization_id=? AND entity_type='CatalogImportBatch'",[org]).catch(()=>{});
    await write("DELETE FROM catalog_import_batches WHERE organization_id=?",[org]).catch(()=>{});
    await write("DELETE FROM users WHERE id=?",[author]).catch(()=>{});
    await write("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
