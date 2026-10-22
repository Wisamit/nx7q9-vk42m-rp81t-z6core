import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  createCatalogApprovalEvidence,verifyCatalogApprovalHistory,
  type CatalogApprovalContext,type CatalogApprovalAuditEvent,
} from "../src/lib/catalog-f2-approval-evidence.ts";

test("F2 MariaDB: separate clinical/finance MFA decisions form immutable signed ledger independent of UUID event order",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const settings={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(settings),mysql.createConnection(settings)]);
  const organizationId=randomUUID(),branchId=randomUUID(),authorUserId=randomUUID(),
    clinician=randomUUID(),finance=randomUUID(),batchId=randomUUID();
  const [eventOne,eventTwo]=[randomUUID(),randomUUID()].sort((a,b)=>b.localeCompare(a));
  const code="F2AS"+organizationId.slice(0,8);
  const secret="synthetic-F2-dual-approval-ledger-key-never-production-32";
  const context:CatalogApprovalContext={
    organizationId,batchId,branchId,authorUserId,sourceChecksum:"a".repeat(64),
    stagedEvidenceDigest:"b".repeat(64),liveSnapshotDigest:"c".repeat(64),
    policyDigest:"d".repeat(64),effectiveAt:"2026-10-23T00:00:00.000Z",
  };
  const a=createCatalogApprovalEvidence(context,{
    revision:1,previousDigest:null,domain:"CLINICAL",decision:"APPROVE",
    signerUserId:clinician,mfaVerifiedAt:"2026-10-20T15:00:00.000Z",
    signedAt:"2026-10-20T15:01:00.000Z",
  },secret);
  const b=createCatalogApprovalEvidence(context,{
    revision:2,previousDigest:a.digest,domain:"FINANCIAL",decision:"APPROVE",
    signerUserId:finance,mfaVerifiedAt:"2026-10-20T15:01:00.000Z",
    signedAt:"2026-10-20T15:02:00.000Z",
  },secret);
  const query=(sql:string,args:Array<string|number|null>)=>writer.execute(sql,args);
  const history=async()=>{
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,actor_user_id AS actorUserId,branch_id AS branchId,new_values AS newValues FROM audit_events WHERE organization_id=? AND action='CATALOG_F2_CONFIGURATION_APPROVAL_SIGNED' AND entity_type='CatalogImportBatch' AND entity_id=? ORDER BY occurred_at DESC,id DESC LIMIT 3",
      [organizationId,batchId]);
    return verifyCatalogApprovalHistory({context,secret,
      events:rows.map(row=>({
        id:String(row.id),actorUserId:row.actorUserId as string|null,
        branchId:row.branchId as string|null,
        newValues:typeof row.newValues==="string"?JSON.parse(row.newValues):row.newValues,
      } satisfies CatalogApprovalAuditEvent)),
    });
  };
  try {
    await query("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [organizationId,code+"O","Synthetic F2 dual approval org"]);
    await query("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branchId,organizationId,code+"B","Synthetic F2 branch"]);
    for(const [id,tag] of [[authorUserId,"A"],[clinician,"C"],[finance,"F"]])
      await query("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,organizationId,code+tag,"Synthetic signer"]);
    await query("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','synthetic.json',?,'DRAFT',?,NOW(3))",
      [batchId,organizationId,context.sourceChecksum,authorUserId]);
    assert.equal((await history())?.revision,0);
    const insert="INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values,occurred_at) VALUES(?,?,?,?,'CATALOG_F2_CONFIGURATION_APPROVAL_SIGNED','CatalogImportBatch',?,?,?)";
    await query(insert,[eventOne,organizationId,branchId,clinician,batchId,JSON.stringify(a),"2026-10-20 15:02:00.000"]);
    assert.equal((await history())?.technicallyApproved,false);
    await query(insert,[eventTwo,organizationId,branchId,finance,batchId,JSON.stringify(b),"2026-10-20 15:02:00.000"]);
    const [physical]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE id IN (?,?) ORDER BY occurred_at DESC,id DESC",[eventOne,eventTwo]);
    assert.deepEqual(physical.map(row=>row.id),[eventOne,eventTwo]);
    assert.equal((await history())?.revision,2);
    assert.equal((await history())?.technicallyApproved,true);
    assert.equal((await history())?.liveApplyAuthorized,false);
    await query("UPDATE audit_events SET actor_user_id=? WHERE id=?",[authorUserId,eventTwo]);
    assert.equal(await history(),null);
    await query("UPDATE audit_events SET actor_user_id=? WHERE id=?",[finance,eventTwo]);
    await query("UPDATE audit_events SET new_values=? WHERE id=?",
      [JSON.stringify({...a,decision:"REJECT"}),eventOne]);
    assert.equal(await history(),null);
    await query("UPDATE audit_events SET new_values=? WHERE id=?",[JSON.stringify(a),eventOne]);
    assert.equal((await history())?.technicallyApproved,true);
    const [masters]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM lab_tests WHERE organization_id=?",[organizationId]);
    assert.equal(Number(masters[0].count),0,"signing cannot change catalog masters");
  }finally{
    await query("DELETE FROM audit_events WHERE id IN (?,?)",[eventOne,eventTwo]).catch(()=>{});
    await query("DELETE FROM catalog_import_batches WHERE id=?",[batchId]).catch(()=>{});
    await query("DELETE FROM users WHERE id IN (?,?,?)",[authorUserId,clinician,finance]).catch(()=>{});
    await query("DELETE FROM branches WHERE id=?",[branchId]).catch(()=>{});
    await query("DELETE FROM organizations WHERE id=?",[organizationId]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
