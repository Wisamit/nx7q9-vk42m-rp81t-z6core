import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {catalogExportTypes} from "../src/lib/catalog-configuration-export.ts";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {compileF2ApplyPlan} from "../src/lib/catalog-f2-apply-plan.ts";
import {recordF2CatalogMasterRevisionsUnderLock,
 resolveF2CatalogMasterAsOf} from "../src/lib/catalog-f2-master-revisions.ts";

test("F2 MariaDB: seven immutable master revisions survive real commit, idempotence, as-of reads and tamper rejection",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const sql=await mysql.createConnection({
    host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1),
  });
  const organizationId=randomUUID(),branchId=randomUUID(),batchId=randomUUID();
  const actorUserId=randomUUID(),clinicalSignerId=randomUUID(),
    financialSignerId=randomUUID();
  const now=new Date("2026-10-21T00:00:00.000Z");
  const effect="2026-12-01T00:00:00.000Z";
  const code="F2REV"+organizationId.slice(0,8);
  const authority={
    organizationId,branchId,batchId,actorUserId,clinicalSignerId,financialSignerId,
    journalSigningSecret:"synthetic-MariaDB-F2-seven-overlay-HMAC-key-not-operational",
    sourceInstallationVerified:true,qualifiedDomainSignersVerified:true,
    currentPermissionsAndBranchScopeVerified:true,signedStageAndLiveSnapshotVerified:true,
  } as const;
  const revisionTypes=new Set(["TEST","COMPONENT","UNIT","CONTAINER",
    "PANEL","PACKAGE","PRICE_LIST"]);
  const rows=[...catalogExportTypes].map((entityType,index)=>{
    const old:Record<string,unknown>={};
    for(const key of catalogBundleAllowedSourceFields[entityType])old[key]=null;
    old.id=randomUUID();
    if(Object.hasOwn(old,"code"))old.code="F2SYN"+index;
    old.createdAt="2026-01-01T00:00:00.000Z";
    old.updatedAt="2026-10-21T00:00:00.000Z";
    const updated=structuredClone(old);
    if(revisionTypes.has(entityType)){
      if(entityType==="PANEL")updated.items=[{
        testId:randomUUID(),displayOrder:1,required:true,test:{code:"SYN"}}];
      else if(entityType==="PACKAGE")updated.items=[{
        testId:randomUUID(),displayOrder:1,test:{code:"SYN"}}];
      else if(entityType==="CONTAINER")updated.tubeColor="purple";
      else if(entityType==="UNIT")updated.ucumCode="mmol/L";
      else if(entityType==="COMPONENT")updated.reportNameEn="Revised report";
      else updated.nameEn="Revised label";
    }
    return {rowNumber:index+1,entityType,
      sourceData:updated,scopedLiveData:old,normalizedData:{id:old.id}};
  });
  const plan=compileF2ApplyPlan({rows,effectiveAt:effect,
    signedStageVerified:true,independentDomainApprovalsVerified:true,
    scopedLiveSnapshotVerified:true,
  });
  assert.ok(plan);
  assert.equal(plan.changedRows,7);
  type Row=mysql.RowDataPacket & Record<string,unknown>;
  const select=async(query:string,values:unknown[])=>{
    const [data]=await sql.query<mysql.RowDataPacket[]>(query,values);
    return data as Row[];
  };
  const safeJson=(v:unknown)=>typeof v==="string"?JSON.parse(v):v;
  const db={
    catalogImportBatch:{findFirst:async()=>{
      const r=await select("SELECT id FROM catalog_import_batches WHERE id=? AND organization_id=? AND source_type='CONFIG_BUNDLE_REVIEW' AND status='DRAFT' LIMIT 1",
        [batchId,organizationId]);return r[0]||null;
    }},
    catalogConfigurationRevision:{
      findMany:async(options:{where:Record<string,unknown>,take?:number})=>{
        const w=options.where;
        let query="SELECT * FROM catalog_config_revisions WHERE organization_id=?";
        const params:unknown[]=[w.organizationId];
        if(w.sourceBatchId){query+=" AND source_batch_id=?";params.push(w.sourceBatchId);}
        if(w.entityType){query+=" AND entity_type=?";params.push(w.entityType);}
        if(w.entityId){query+=" AND entity_id=?";params.push(w.entityId);}
        if(w.state){query+=" AND state=?";params.push(w.state);}
        if(w.effectiveFrom){
          query+=" AND effective_from<=?";
          params.push((w.effectiveFrom as {lte:Date}).lte);
        }
        if(w.OR){
          query+=" AND (effective_to IS NULL OR effective_to>?)";
          params.push((w.OR as Array<{effectiveTo?:{gt:Date}}>)[1].effectiveTo!.gt);
        }
        query+=" ORDER BY revision DESC";
        if(options.take){query+=" LIMIT ?";params.push(options.take);}
        return (await select(query,params)).map(x=>({
          id:x.id,sourceRowNumber:x.source_row_number,
          planDigest:x.plan_digest,originalDigest:x.original_digest,
          desiredDigest:x.desired_digest,effectiveFrom:x.effective_from,
          effectiveTo:x.effective_to,state:x.state,revision:x.revision,
          afterSnapshot:safeJson(x.after_snapshot),
        }));
      },
      create:async({data}:{data:Record<string,unknown>})=>{
        const id=randomUUID();
        await sql.execute(
          "INSERT INTO catalog_config_revisions(id,organization_id,branch_id,source_batch_id,source_row_number,entity_type,entity_id,revision,effective_from,state,before_snapshot,after_snapshot,original_digest,desired_digest,plan_digest,created_by_user_id,clinical_signer_user_id,financial_signer_user_id) VALUES(?,?,?,?,?,?,?,?,?,'RECORDED',?,?,?,?,?,?,?,?)",
          [id,data.organizationId,data.branchId,data.sourceBatchId,
           data.sourceRowNumber,data.entityType,data.entityId,data.revision,
           data.effectiveFrom,JSON.stringify(data.beforeSnapshot),
           JSON.stringify(data.afterSnapshot),data.originalDigest,data.desiredDigest,
           data.planDigest,data.createdByUserId,data.clinicalSignerUserId,
           data.financialSignerUserId]);
        return {id};
      },
      updateMany:async({where,data}:{where:{id:string},data:{effectiveTo:Date}})=>{
        const [res]=await sql.execute<mysql.ResultSetHeader>(
          "UPDATE catalog_config_revisions SET effective_to=? WHERE id=? AND effective_to IS NULL AND state='RECORDED'",
          [data.effectiveTo,where.id]);
        return {count:res.affectedRows};
      },
    },
    auditEvent:{create:async({data}:{data:Record<string,unknown>})=>{
      const id=randomUUID();
      await sql.execute(
        "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,?,?,?,?)",
        [id,data.organizationId,data.branchId,data.actorUserId,data.action,
         data.entityType,data.entityId,JSON.stringify(data.newValues)]);
      return {id};
    }},
  };
  const insert=async(q:string,v:unknown[])=>sql.execute(q,v);
  try{
    await insert("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [organizationId,code+"O","Synthetic F2 Master Version Org"]);
    await insert("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branchId,organizationId,code+"B","Synthetic F2 Branch"]);
    for(const [id,tag] of [[actorUserId,"A"],[clinicalSignerId,"C"],[financialSignerId,"F"]])
      await insert("INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
        [id,organizationId,code+tag,"Synthetic signer"]);
    await insert("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','synthetic.json',?,'DRAFT',?,NOW(3))",
      [batchId,organizationId,"a".repeat(64),actorUserId]);
    await sql.beginTransaction();
    const locked=await select("SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",
      [organizationId]);assert.equal(locked.length,1);
    const applied=await recordF2CatalogMasterRevisionsUnderLock(db as never,plan,
      authority,now);
    assert.equal(applied.count,7);
    assert.equal(applied.state,"MASTER_REVISIONS_RECORDED");
    await sql.commit();
    const actual=await select(
      "SELECT COUNT(*) AS cnt FROM catalog_config_revisions WHERE organization_id=? AND source_batch_id=?",
      [organizationId,batchId]);
    assert.equal(Number(actual[0].cnt),7);
    const unchanged=await resolveF2CatalogMasterAsOf(db as never,{
      organizationId,entityType:"TEST",
      entityId:rows.find(x=>x.entityType==="TEST")!.normalizedData.id as string,
      asOf:now,
    });
    assert.equal(unchanged,null);
    const latest=await resolveF2CatalogMasterAsOf(db as never,{
      organizationId,entityType:"TEST",
      entityId:rows.find(x=>x.entityType==="TEST")!.normalizedData.id as string,
      asOf:new Date("2026-12-02T00:00:00.000Z"),
    });
    assert.equal(latest?.nameEn,"Revised label");
    await sql.beginTransaction();
    const second=await recordF2CatalogMasterRevisionsUnderLock(db as never,
      plan,authority,now);
    assert.equal(second.state,"MASTER_REVISIONS_ALREADY_RECORDED");
    await sql.commit();
    const after=await select("SELECT COUNT(*) AS cnt FROM catalog_config_revisions WHERE source_batch_id=?",
      [batchId]);
    assert.equal(Number(after[0].cnt),7);
    const target=rows.find(x=>x.entityType==="TEST")!.normalizedData.id as string;
    await insert("UPDATE catalog_config_revisions SET after_snapshot=? WHERE source_batch_id=? AND entity_type='TEST'",
      [JSON.stringify({...latest,nameEn:"TAMPERED"}),batchId]);
    await assert.rejects(()=>resolveF2CatalogMasterAsOf(db as never,{
      organizationId,entityType:"TEST",entityId:target,
      asOf:new Date("2026-12-02T00:00:00.000Z"),
    }),/snapshot_corrupt/);
  }finally{
    await sql.rollback().catch(()=>{});
    await insert("DELETE FROM audit_events WHERE organization_id=? AND entity_type IN ('TEST','COMPONENT','UNIT','CONTAINER','PANEL','PACKAGE','PRICE_LIST')",
      [organizationId]).catch(()=>{});
    await insert("DELETE FROM catalog_config_revisions WHERE organization_id=?",[organizationId]).catch(()=>{});
    await insert("DELETE FROM catalog_import_batches WHERE id=?",[batchId]).catch(()=>{});
    await insert("DELETE FROM users WHERE id IN (?,?,?)",
      [actorUserId,clinicalSignerId,financialSignerId]).catch(()=>{});
    await insert("DELETE FROM branches WHERE id=?",[branchId]).catch(()=>{});
    await insert("DELETE FROM organizations WHERE id=?",[organizationId]).catch(()=>{});
    await sql.end();
  }
});
