import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  createMappingDiscussionDraft, verifyMappingDiscussionHistory,
  mappingDiscussionCurrent, type MappingDiscussionContext,
} from "../src/lib/catalog-mapping-discussion-draft.ts";

test("F2 MariaDB: two independent sessions verify append-only row mapping discussion history",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),branch=randomUUID(),branchOther=randomUUID(),
    author=randomUUID(),authorOther=randomUUID(),batch=randomUUID(),
    row=randomUUID(),sourceId=randomUUID(),a=randomUUID(),b=randomUUID();
  const code="F2MD"+org.slice(0,8);
  const secret="synthetic-F2-mapping-audit-HMAC-test-key-never-live-32";
  const context:MappingDiscussionContext={
    organizationId:org,batchId:batch,branchId:branch,rowId:row,
    authorUserId:author,sourceChecksum:"f".repeat(64),
    rowNumber:1,entityType:"TEST",
  };
  const token="a".repeat(64),nextToken="b".repeat(64);
  const e1=createMappingDiscussionDraft(context,{
    revision:1,previousDigest:null,observationToken:token,
    intent:"REQUEST_EXTERNAL_MAPPING",
  },secret);
  const e2=createMappingDiscussionDraft(context,{
    revision:2,previousDigest:e1.digest,observationToken:nextToken,
    intent:"RETURN_TO_SOURCE_AUTHOR",
  },secret);
  const json=(x:unknown):unknown=>typeof x==="string"?JSON.parse(x):x;
  const write=(sql:string,args:Array<string|number|null>)=>writer.execute(sql,args);
  const history=async()=>{
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,branch_id AS branchId,actor_user_id AS actorUserId,new_values AS newValues FROM audit_events WHERE organization_id=? AND entity_type='CatalogImportRow' AND entity_id=? AND action='CATALOG_BUNDLE_MAPPING_DISCUSSION_DRAFT_RECORDED' ORDER BY occurred_at DESC,id DESC LIMIT 101",
      [org,row]);
    return verifyMappingDiscussionHistory({context,secret,events:rows.map(r=>({
      id:String(r.id),branchId:r.branchId as string|null,
      actorUserId:r.actorUserId as string|null,
      newValues:json(r.newValues),
    }))});
  };
  try {
    await write("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,code+"O","F2 mapping synthetic org"]);
    for(const [id,suffix] of [[branch,"A"],[branchOther,"B"]])
      await write("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,code+suffix,"F2 synthetic branch"]);
    for(const [id,suffix] of [[author,"A"],[authorOther,"B"]])
      await write("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,code+"U"+suffix,"F2 mapping author"]);
    await write("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','mapping.json',?,'DRAFT',?,NOW(3))",
      [batch,org,context.sourceChecksum,author]);
    await write("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,legacy_key,source_data,normalized_data,validation_issues,updated_at) VALUES(?,?,1,'TEST','WARNING',?,?,?,?,NOW(3))",
      [row,batch,sourceId,JSON.stringify({id:sourceId,code}),JSON.stringify({id:sourceId,code}),JSON.stringify([])]);
    assert.deepEqual(await history(),{revision:0,draft:null});
    await write("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_MAPPING_DISCUSSION_DRAFT_RECORDED','CatalogImportRow',?,?,?)",
      [a,org,branch,author,row,JSON.stringify(e1),"2026-10-20 10:00:01.000"]);
    assert.deepEqual(await history(),{revision:1,draft:e1});
    await write("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_BUNDLE_MAPPING_DISCUSSION_DRAFT_RECORDED','CatalogImportRow',?,?,?)",
      [b,org,branch,author,row,JSON.stringify(e2),"2026-10-20 10:00:02.000"]);
    assert.deepEqual(await history(),{revision:2,draft:e2});
    assert.equal(mappingDiscussionCurrent((await history())!.draft,token),false);
    assert.equal(mappingDiscussionCurrent((await history())!.draft,nextToken),true);
    await write("UPDATE audit_events SET branch_id=? WHERE id=?",[branchOther,a]);
    assert.equal(await history(),null);
    await write("UPDATE audit_events SET branch_id=? WHERE id=?",[branch,a]);
    await write("UPDATE audit_events SET actor_user_id=? WHERE id=?",[authorOther,b]);
    assert.equal(await history(),null);
    await write("UPDATE audit_events SET actor_user_id=? WHERE id=?",[author,b]);
    await write("UPDATE audit_events SET new_values=? WHERE id=?",
      [JSON.stringify({...e1,intent:"RETURN_TO_SOURCE_AUTHOR"}),a]);
    assert.equal(await history(),null);
    await write("UPDATE audit_events SET new_values=? WHERE id=?",[JSON.stringify(e1),a]);
    assert.deepEqual(await history(),{revision:2,draft:e2});
    // A database writer can recompute the SHA digest of a replacement
    // decision, but cannot forge our independent server HMAC.
    const attackerSecret="attacker-database-writer-can-change-JSON-not-KEY";
    const forged=createMappingDiscussionDraft(context,{
      revision:2,previousDigest:e1.digest,observationToken:nextToken,
      intent:"PROPOSE_LOCAL_RECONCILIATION",
    },attackerSecret);
    await write("UPDATE audit_events SET new_values=? WHERE id=?",
      [JSON.stringify(forged),b]);
    assert.equal(await history(),null);
    await write("UPDATE audit_events SET new_values=? WHERE id=?",
      [JSON.stringify(e2),b]);
    assert.deepEqual(await history(),{revision:2,draft:e2});
  } finally {
    await write("DELETE FROM audit_events WHERE id IN (?,?)",[a,b]).catch(()=>{});
    await write("DELETE FROM catalog_import_rows WHERE id=?",[row]).catch(()=>{});
    await write("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await write("DELETE FROM users WHERE id IN (?,?)",[author,authorOther]).catch(()=>{});
    await write("DELETE FROM branches WHERE organization_id=?",[org]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
