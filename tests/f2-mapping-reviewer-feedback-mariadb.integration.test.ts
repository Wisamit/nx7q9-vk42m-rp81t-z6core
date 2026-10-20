import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  createMappingFeedbackDraft, verifyMappingFeedbackHistory,
  type MappingFeedbackContext,
} from "../src/lib/catalog-mapping-reviewer-feedback.ts";

test("F2 MariaDB: independent reviewer correction history is HMAC-authenticated, tenant scoped and append-only",
{timeout:60000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),otherOrg=randomUUID(),branch=randomUUID(),
    author=randomUUID(),reviewer=randomUUID(),another=randomUUID(),
    batch=randomUUID(),row=randomUUID(),id1=randomUUID(),id2=randomUUID(),
    sourceId=randomUUID();
  const code="F2MF"+org.slice(0,8),secret="test-f2-independent-feedback-mariadb-hmac-key-32";
  const context:MappingFeedbackContext={
    organizationId:org,batchId:batch,branchId:branch,rowId:row,
    authorUserId:author,sourceChecksum:"e".repeat(64),rowNumber:1,entityType:"TEST",
  };
  const first=createMappingFeedbackDraft(context,{
    reviewerUserId:reviewer,revision:1,previousDigest:null,
    authorDraftDigest:"a".repeat(64),observationToken:"b".repeat(64),
    disposition:"REQUEST_SOURCE_INSTALLATION_EVIDENCE",
  },secret);
  const second=createMappingFeedbackDraft(context,{
    reviewerUserId:another,revision:2,previousDigest:first.digest,
    authorDraftDigest:"a".repeat(64),observationToken:"b".repeat(64),
    disposition:"RETURN_MAPPING_TO_AUTHOR",
  },secret);
  const write=(sql:string,params:Array<string|number|null>)=>writer.execute(sql,params);
  const read=async(ctx=context)=>{
    await reader.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await reader.beginTransaction();
    try {
      const [locked]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[ctx.organizationId]);
      if(locked.length!==1)return null;
      const [events]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT a.id,a.actor_user_id AS actorUserId,a.branch_id AS branchId,a.new_values AS newValues FROM audit_events a WHERE a.organization_id=? AND a.entity_type='CatalogImportRow' AND a.entity_id=? AND a.action='CATALOG_BUNDLE_MAPPING_FEEDBACK_RECORDED' ORDER BY a.occurred_at DESC,a.id DESC LIMIT 101",
        [ctx.organizationId,ctx.rowId]);
      return verifyMappingFeedbackHistory({context:ctx,secret,events:events.map(e=>({
        id:e.id as string,actorUserId:e.actorUserId as string|null,
        branchId:e.branchId as string|null,
        newValues:typeof e.newValues==="string"?JSON.parse(e.newValues):e.newValues,
      }))});
    }finally{await reader.commit();}
  };
  try {
    for(const [id,suffix] of [[org,"A"],[otherOrg,"B"]])
      await write("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,code+suffix,"F2 feedback synthetic org"]);
    await write("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,code+"BR","F2 synthetic branch"]);
    for(const [user,suffix] of [[author,"A"],[reviewer,"R"],[another,"S"]])
      await write("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [user,org,code+"U"+suffix,"Synthetic reviewer"]);
    await write("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','f2-feedback.json',?,'DRAFT',?,NOW(3))",
      [batch,org,context.sourceChecksum,author]);
    await write("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,legacy_key,source_data,normalized_data,validation_issues,updated_at) VALUES(?,?,1,'TEST','WARNING',?,?,?,?,NOW(3))",
      [row,batch,sourceId,JSON.stringify({id:sourceId,code}),JSON.stringify({id:sourceId,code}),JSON.stringify([])]);
    assert.deepEqual(await read(),{revision:0,latest:null});
    await write("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_MAPPING_FEEDBACK_RECORDED','CatalogImportRow',?,?,?)",
      [id1,org,branch,reviewer,row,JSON.stringify(first),"2026-10-20 09:00:01.000"]);
    assert.deepEqual(await read(),{revision:1,latest:first});
    assert.equal(await read({...context,organizationId:otherOrg}),null);
    await write("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_MAPPING_FEEDBACK_RECORDED','CatalogImportRow',?,?,?)",
      [id2,org,branch,another,row,JSON.stringify(second),"2026-10-20 09:00:02.000"]);
    assert.deepEqual(await read(),{revision:2,latest:second});
    // Mutations in the persisted *audit*, not application writes, simulate
    // a compromised editor. The HMAC and persisted actor are both binding.
    await write("UPDATE audit_events SET actor_user_id=? WHERE id=?",[author,id2]);
    assert.equal(await read(),null);
    await write("UPDATE audit_events SET actor_user_id=? WHERE id=?",[another,id2]);
    await write("UPDATE audit_events SET branch_id=NULL WHERE id=?",[id1]);
    assert.equal(await read(),null);
    await write("UPDATE audit_events SET branch_id=? WHERE id=?",[branch,id1]);
    await write("UPDATE audit_events SET new_values=? WHERE id=?",
      [JSON.stringify({...first,approved:true}),id1]);
    assert.equal(await read(),null);
    await write("UPDATE audit_events SET new_values=? WHERE id=?",[JSON.stringify(first),id1]);
    assert.deepEqual(await read(),{revision:2,latest:second});
    const [records]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM catalog_import_rows WHERE batch_id=? AND status='WARNING' AND imported_entity_id IS NULL",
      [batch]);
    assert.equal(Number(records[0].total),1);
  }finally{
    await write("DELETE FROM audit_events WHERE id IN (?,?)",[id1,id2]).catch(()=>{});
    await write("DELETE FROM catalog_import_rows WHERE id=?",[row]).catch(()=>{});
    await write("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await write("DELETE FROM users WHERE id IN (?,?,?)",[author,reviewer,another]).catch(()=>{});
    await write("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id IN (?,?)",[org,otherOrg]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
