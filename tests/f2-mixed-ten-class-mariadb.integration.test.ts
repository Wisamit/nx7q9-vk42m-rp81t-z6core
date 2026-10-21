import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {catalogExportTypes} from "../src/lib/catalog-configuration-export.ts";
import {catalogBundleAllowedSourceFields} from "../src/lib/catalog-bundle-source-boundary.ts";
import {catalogDriftObservationToken} from "../src/lib/catalog-drift-triage.ts";
import {createCatalogApprovalEvidence} from "../src/lib/catalog-f2-approval-evidence.ts";
import {executeF2GovernedApplicationUnderLock,
  type F2GovernedExecutionInput} from "../src/lib/catalog-f2-governed-application.ts";
import {f2MysqlTransactionalTestClient} from "./f2-effective-versions-mariadb-driver.ts";

const secret="f2-full-mixed-atomic-mariadb-synthetic-HMAC-never-production-32";
const start="2026-01-01T00:00:00.000Z";
const at="2026-12-01T00:00:00.000Z";
const now=new Date("2026-10-21T00:00:00.000Z");
type Sql=string|number|Date|null;
const asSql=(v:unknown):Sql=>{
  if(v===null||typeof v==="string"||typeof v==="number"||v instanceof Date)
    return v;
  throw Error("mixed_test_invalid_parameter");
};

/** A thin SQL-backed Prisma-method surrogate; the application service is real. */
function revisionClient(sql:mysql.Connection,override:{
  failOnFirstRevisionCreate:boolean;
}){
  const columns:Record<string,string>={
    id:"id",organizationId:"organization_id",
    sourceBatchId:"source_batch_id",sourceRowNumber:"source_row_number",
    entityType:"entity_type",entityId:"entity_id",state:"state",
    revision:"revision",effectiveFrom:"effective_from",
    effectiveTo:"effective_to",planDigest:"plan_digest",
    originalDigest:"original_digest",desiredDigest:"desired_digest",
  };
  const field=(name:string)=>columns[name]||(
    {cancelledAt:"cancelled_at",cancelledByUserId:"cancelled_by_user_id"} as
      Record<string,string>)[name];
  const select=async(q:string,values:Sql[])=>{
    const [data]=await sql.execute<mysql.RowDataPacket[]>(q,values);
    return data;
  };
  return {
    catalogImportBatch:{
      findFirst:async(opts:{where:{id:string;organizationId:string}})=>{
        const data=await select(
          "SELECT id FROM catalog_import_batches WHERE id=? AND organization_id=? AND status='DRAFT' AND source_type='CONFIG_BUNDLE_REVIEW' LIMIT 1",
          [opts.where.id,opts.where.organizationId]);
        return data[0]??null;
      },
    },
    catalogConfigurationRevision:{
      findMany:async(opts:{
        where:Record<string,unknown>;take?:number;
      })=>{
        const clauses:string[]=[],values:Sql[]=[];
        for(const [name,v] of Object.entries(opts.where)){
          const col=field(name);
          if(!col)throw Error("mixed_test_unknown_where_"+name);
          clauses.push("`"+col+"`"+(v===null?" IS NULL":"=?"));
          if(v!==null)values.push(asSql(v));
        }
        const data=await select(
          "SELECT * FROM catalog_config_revisions WHERE "+
          clauses.join(" AND ")+" ORDER BY revision DESC LIMIT ?",
          [...values,opts.take??5000]);
        return data.map(row=>({
          id:row.id,sourceRowNumber:row.source_row_number,
          organizationId:row.organization_id,branchId:row.branch_id,
          entityType:row.entity_type,entityId:row.entity_id,
          state:row.state,revision:row.revision,
          effectiveFrom:row.effective_from,effectiveTo:row.effective_to,
          originalDigest:row.original_digest,desiredDigest:row.desired_digest,
          planDigest:row.plan_digest,
          afterSnapshot:typeof row.after_snapshot==="string"?
            JSON.parse(row.after_snapshot):row.after_snapshot,
        }));
      },
      create:async({data}:{data:Record<string,unknown>})=>{
        if(override.failOnFirstRevisionCreate){
          override.failOnFirstRevisionCreate=false;
          throw Error("f2_injected_master_failure_after_native_writes");
        }
        const id=randomUUID();
        await sql.execute(
          "INSERT INTO catalog_config_revisions(id,organization_id,branch_id,source_batch_id,source_row_number,entity_type,entity_id,revision,effective_from,state,before_snapshot,after_snapshot,original_digest,desired_digest,plan_digest,created_by_user_id,clinical_signer_user_id,financial_signer_user_id) VALUES(?,?,?,?,?,?,?,?,?,'RECORDED',?,?,?,?,?,?,?,?)",
          [id,data.organizationId,data.branchId,data.sourceBatchId,
            data.sourceRowNumber,data.entityType,data.entityId,
            data.revision,data.effectiveFrom,
            JSON.stringify(data.beforeSnapshot),JSON.stringify(data.afterSnapshot),
            data.originalDigest,data.desiredDigest,data.planDigest,
            data.createdByUserId,data.clinicalSignerUserId,
            data.financialSignerUserId].map(asSql));
        return {id};
      },
      updateMany:async({where,data}:{
        where:Record<string,unknown>;data:Record<string,unknown>;
      })=>{
        const clauses:string[]=[],values:Sql[]=[];
        for(const [fieldName,value] of Object.entries(data)){
          const col=field(fieldName);
          if(!col)throw Error("mixed_test_unknown_update_"+fieldName);
          clauses.push("`"+col+"`=?");
          values.push(asSql(value));
        }
        const predicates:string[]=[];
        for(const [fieldName,value] of Object.entries(where)){
          const col=field(fieldName);
          if(!col)throw Error("mixed_test_unknown_condition_"+fieldName);
          predicates.push("`"+col+"`"+(value===null?" IS NULL":"=?"));
          if(value!==null)values.push(asSql(value));
        }
        const [result]=await sql.execute<mysql.ResultSetHeader>(
          "UPDATE catalog_config_revisions SET "+clauses.join(",")+
          " WHERE "+predicates.join(" AND "),values);
        return {count:result.affectedRows};
      },
    },
  };
}

test("F2 actual MariaDB: ten-class mixed governed apply is atomic across native price/range records and seven master revisions",{
  timeout:120000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const sql=await mysql.createConnection({
    host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1),
  });
  const organizationId=randomUUID(),branchId=randomUUID(),
    batchId=randomUUID(),actorUserId=randomUUID(),authorUserId=randomUUID(),
    clinician=randomUUID(),finance=randomUUID();
  const testId=randomUUID(),componentId=randomUUID(),packageId=randomUUID(),
    priceListId=randomUUID(),itemId=randomUUID(),packageItemId=randomUUID(),
    intervalId=randomUUID();
  const label="F2MIX"+organizationId.slice(0,8);
  const source={
    organizationId,branchId,batchId,actorUserId,authorUserId,
    sourceChecksum:"a".repeat(64),stageEvidenceDigest:"b".repeat(64),
    policyDigest:"c".repeat(64),effectiveAt:at,
    sourceInstallationVerified:true,fullyScopedStageVerified:true,
    fullDomainSignatoryGrantsCurrentlyVerified:true,
    currentOperatorScopesVerified:true,
    independentlyVerifiedInstallationMapping:true,
    appliedVersionJournalValidated:true,
  } as const;
  const nativeIds:Record<string,string>={
    TEST:testId,COMPONENT:componentId,PACKAGE:packageId,
    PRICE_LIST:priceListId,PRICE_LIST_ITEM:itemId,
    PRICE_LIST_PACKAGE_ITEM:packageItemId,REFERENCE_INTERVAL:intervalId,
  };
  const rows=[...catalogExportTypes].map((entityType,i)=>{
    const original:Record<string,unknown>={};
    for(const field of catalogBundleAllowedSourceFields[entityType])
      original[field]=null;
    original.id=nativeIds[entityType]||randomUUID();
    original.createdAt=start;original.updatedAt=start;
    if(Object.hasOwn(original,"code"))original.code="C"+i;
    original.status="ACTIVE";
    if(entityType==="TEST")original.nameEn="Original test";
    if(entityType==="COMPONENT"){
      original.testId=testId;original.nameEn="Original component";
      original.test={code:"C0"};
    }
    if(entityType==="UNIT"){
      original.symbol="unit";original.nameEn="Unit";
    }
    if(entityType==="PANEL")original.items=[
      {testId,displayOrder:1,required:true,test:{code:"C0"}}];
    if(entityType==="PACKAGE")original.items=[
      {testId,displayOrder:1,test:{code:"C0"}}];
    if(entityType==="PRICE_LIST"){
      original.scopeType="ORGANIZATION";original.currency="AED";
      original.nameEn="Tariff";original.priority=1;
      original.effectiveFrom=start;
    }
    if(entityType==="PRICE_LIST_ITEM"||entityType==="PRICE_LIST_PACKAGE_ITEM"){
      original.priceListId=priceListId;
      if(entityType==="PRICE_LIST_ITEM")original.testId=testId;
      else original.packageId=packageId;
      original.unitPrice="150.0000";original.effectiveFrom=start;
      original.priceList={
        code:"C"+[...catalogExportTypes].indexOf("PRICE_LIST"),
        currency:"AED",scopeType:"ORGANIZATION",branchId:null,
        status:"ACTIVE",sourceId:null,referrerId:null,
        clientId:null,contractId:null,
      };
      if(entityType==="PRICE_LIST_ITEM")original.test={code:"C0"};
      else original.package={code:"C"+[...catalogExportTypes].indexOf("PACKAGE")};
    }
    if(entityType==="REFERENCE_INTERVAL"){
      original.componentId=componentId;original.sex="ANY";
      original.lowValue="1.000000";original.highValue="9.000000";
      original.criticalLow="0.500000";original.criticalHigh="10.000000";
      original.effectiveFrom=start;original.approvalStatus="APPROVED";
      original.component={code:"C1",test:{code:"C0"}};
    }
    const desired=structuredClone(original);
    if(entityType==="TEST")desired.nameEn="Future test label";
    if(entityType==="COMPONENT")desired.reportNameEn="Future component label";
    if(entityType==="UNIT")desired.ucumCode="mmol/L";
    if(entityType==="CONTAINER")desired.tubeColor="lavender";
    if(entityType==="PANEL")desired.items=[
      {testId,displayOrder:2,required:true,test:{code:"C0"}}];
    if(entityType==="PACKAGE")desired.items=[
      {testId,displayOrder:2,test:{code:"C0"}}];
    if(entityType==="PRICE_LIST")desired.priority=9;
    if(entityType==="PRICE_LIST_ITEM"||entityType==="PRICE_LIST_PACKAGE_ITEM")
      desired.unitPrice="122.7500";
    if(entityType==="REFERENCE_INTERVAL")desired.criticalLow="0.750000";
    return {rowNumber:i+1,entityType,
      sourceData:desired,scopedLiveData:original,normalizedData:{id:original.id}};
  });
  const fingerprint=createHash("sha256");
  for(const row of rows){
    const digest=catalogDriftObservationToken(secret,source.sourceChecksum,
      row.rowNumber,row.entityType,row.sourceData,row.scopedLiveData);
    fingerprint.update(JSON.stringify([row.rowNumber,row.entityType,digest]));
  }
  const context={
    organizationId,batchId,branchId,authorUserId,
    sourceChecksum:source.sourceChecksum,
    stagedEvidenceDigest:source.stageEvidenceDigest,
    liveSnapshotDigest:fingerprint.digest("hex"),
    policyDigest:source.policyDigest,effectiveAt:at,
  };
  const approvalA=createCatalogApprovalEvidence(context,{
    revision:1,previousDigest:null,domain:"CLINICAL",decision:"APPROVE",
    signerUserId:clinician,mfaVerifiedAt:"2026-10-21T00:00:00.000Z",
    signedAt:"2026-10-21T00:01:00.000Z",
  },secret);
  const approvalB=createCatalogApprovalEvidence(context,{
    revision:2,previousDigest:approvalA.digest,domain:"FINANCIAL",
    decision:"APPROVE",signerUserId:finance,
    mfaVerifiedAt:"2026-10-21T00:01:00.000Z",
    signedAt:"2026-10-21T00:02:00.000Z",
  },secret);
  const approvals=[
    {id:randomUUID(),actorUserId:clinician,branchId,newValues:approvalA},
    {id:randomUUID(),actorUserId:finance,branchId,newValues:approvalB},
  ];
  const input:F2GovernedExecutionInput={
    source,mode:"APPLY",rows,approvals,secret,now,
  };
  const query=async(q:string,args:unknown[]=[])=>sql.execute(q,args.map(asSql));
  const scalar=async(q:string,args:unknown[]=[])=>{
    const [result]=await sql.execute<mysql.RowDataPacket[]>(q,args.map(asSql));
    return Number(result[0].count);
  };
  const invoke=async(failOnFirstRevisionCreate:boolean,
    mode:"APPLY"|"REVERSE"="APPLY")=>{
    await sql.beginTransaction();
    try{
      const [locks]=await sql.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",
        [organizationId]);
      assert.equal(locks.length,1);
      const base=f2MysqlTransactionalTestClient(sql);
      const revisions=revisionClient(sql,{failOnFirstRevisionCreate});
      const outcome=await executeF2GovernedApplicationUnderLock({
        ...base,...revisions,
      } as never,{...input,mode});
      await sql.commit();
      return outcome;
    }catch(error){
      await sql.rollback();
      throw error;
    }
  };
  try{
    await query("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [organizationId,label+"O","F2 Mixed Synthetic Organization"]);
    await query("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branchId,organizationId,label+"B","F2 Mixed Branch"]);
    for(const [id,suffix] of [
      [actorUserId,"A"],[authorUserId,"O"],[clinician,"C"],[finance,"F"],
    ])await query(
      "INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
      [id,organizationId,label+suffix,"Synthetic F2 staff"]);
    await query(
      "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','mixed.json',?,'DRAFT',?,NOW(3))",
      [batchId,organizationId,source.sourceChecksum,authorUserId]);
    await query(
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,organizationId,label+"T","Synthetic Test"]);
    await query(
      "INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [componentId,testId,label+"C","Synthetic Result Component"]);
    await query(
      "INSERT INTO commercial_packages(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [packageId,organizationId,label+"P","Synthetic Package"]);
    await query(
      "INSERT INTO price_lists(id,organization_id,code,name_en,currency,effective_from,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [priceListId,organizationId,label+"L","Synthetic Price List","AED","2026-01-01 00:00:00.000"]);
    await query(
      "INSERT INTO price_list_items(id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [itemId,priceListId,testId,"150.0000","2026-01-01 00:00:00.000"]);
    await query(
      "INSERT INTO price_list_package_items(id,price_list_id,package_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [packageItemId,priceListId,packageId,"150.0000","2026-01-01 00:00:00.000"]);
    await query(
      "INSERT INTO reference_intervals(id,component_id,sex,low_value,high_value,critical_low,critical_high,effective_from,approval_status,status,updated_at) VALUES(?,?,'ANY',?,?,?,?,?,'APPROVED','ACTIVE',NOW(3))",
      [intervalId,componentId,"1.000000","9.000000","0.500000","10.000000","2026-01-01 00:00:00.000"]);

    // An induced crash AFTER three native clones must roll back BOTH families.
    await assert.rejects(()=>invoke(true),
      /f2_injected_master_failure_after_native_writes/);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM catalog_config_revisions WHERE source_batch_id=?",[batchId]),0);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM price_list_items WHERE price_list_id=?",[priceListId]),1);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM price_list_package_items WHERE price_list_id=?",[priceListId]),1);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM reference_intervals WHERE component_id=?",[componentId]),1);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM audit_events WHERE organization_id=?",[organizationId]),0);
    const applied=await invoke(false);
    assert.equal(applied.state,"TEN_CLASS_CONFIGURATION_SCHEDULED");
    if(applied.state!=="TEN_CLASS_CONFIGURATION_SCHEDULED")
      throw Error("f2_mixed_expected_ten_class_result");
    assert.equal(applied.nativeChangedRows,3);
    assert.equal(applied.masterChangedRows,7);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM catalog_config_revisions WHERE source_batch_id=? AND state='RECORDED'",
      [batchId]),7);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM price_list_items WHERE price_list_id=?",[priceListId]),2);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM price_list_package_items WHERE price_list_id=?",[priceListId]),2);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM reference_intervals WHERE component_id=?",[componentId]),2);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM audit_events WHERE organization_id=? AND action='CATALOG_F2_VERSION_CLONED'",
      [organizationId]),3);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM audit_events WHERE organization_id=? AND action='CATALOG_F2_MASTER_REVISION_SCHEDULED'",
      [organizationId]),7);
    const replay=await invoke(false);
    assert.equal(replay.state,"TEN_CLASS_CONFIGURATION_SCHEDULED");
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM catalog_config_revisions WHERE source_batch_id=?",[batchId]),7,
      "replay must not create any additional master revisions");
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM reference_intervals WHERE component_id=?",[componentId]),2,
      "replay must not create an additional clinical interval");
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM price_list_items WHERE price_list_id=?",[priceListId]),2,
      "replay must not create an additional billed tariff");
    // The same signed, frozen pre-apply observations support an independent
    // compensating reversal while the change is still future-effective.
    // SQL must preserve every clone as retired/cancelled history, never DELETE.
    const reversed=await invoke(false,"REVERSE");
    assert.equal(reversed.state,"TEN_CLASS_CONFIGURATION_REVERSED");
    if(reversed.state!=="TEN_CLASS_CONFIGURATION_REVERSED")
      throw Error("f2_mixed_expected_reverse_result");
    assert.equal(reversed.nativeChangedRows,3);
    assert.equal(reversed.masterChangedRows,7);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM catalog_config_revisions WHERE source_batch_id=? AND state='CANCELLED'",
      [batchId]),7);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM price_list_items WHERE price_list_id=? AND status='INACTIVE'",
      [priceListId]),1);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM price_list_package_items WHERE price_list_id=? AND status='INACTIVE'",
      [priceListId]),1);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM reference_intervals WHERE component_id=? AND approval_status='RETIRED'",
      [componentId]),1);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM price_list_items WHERE id=? AND effective_to IS NULL AND status='ACTIVE'",
      [itemId]),1);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM price_list_package_items WHERE id=? AND effective_to IS NULL AND status='ACTIVE'",
      [packageItemId]),1);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM reference_intervals WHERE id=? AND effective_to IS NULL AND approval_status='APPROVED'",
      [intervalId]),1);
    // Reversals are idempotent, and neither replay nor a later APPLY may
    // recreate the previously compensated future versions.
    const secondReversal=await invoke(false,"REVERSE");
    assert.equal(secondReversal.state,"TEN_CLASS_CONFIGURATION_REVERSED");
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM catalog_config_revisions WHERE source_batch_id=?",[batchId]),7);
    await assert.rejects(()=>invoke(false,"APPLY"),
      /f2_apply_batch_previously_reversed/);
    assert.equal(await scalar(
      "SELECT COUNT(*) AS count FROM price_list_items WHERE price_list_id=?",[priceListId]),2);

  }finally{
    await sql.rollback().catch(()=>{});
    for(const statement of [
      "DELETE FROM audit_events WHERE organization_id=?",
      "DELETE FROM catalog_config_revisions WHERE organization_id=?",
    ])await query(statement,[organizationId]).catch(()=>{});
    await query("DELETE FROM price_list_package_items WHERE price_list_id=?",[priceListId]).catch(()=>{});
    await query("DELETE FROM price_list_items WHERE price_list_id=?",[priceListId]).catch(()=>{});
    await query("DELETE FROM reference_intervals WHERE component_id=?",[componentId]).catch(()=>{});
    await query("DELETE FROM price_lists WHERE id=?",[priceListId]).catch(()=>{});
    await query("DELETE FROM commercial_packages WHERE id=?",[packageId]).catch(()=>{});
    await query("DELETE FROM test_components WHERE id=?",[componentId]).catch(()=>{});
    await query("DELETE FROM lab_tests WHERE id=?",[testId]).catch(()=>{});
    await query("DELETE FROM catalog_import_batches WHERE id=?",[batchId]).catch(()=>{});
    await query("DELETE FROM users WHERE id IN (?,?,?,?)",
      [actorUserId,authorUserId,clinician,finance]).catch(()=>{});
    await query("DELETE FROM branches WHERE id=?",[branchId]).catch(()=>{});
    await query("DELETE FROM organizations WHERE id=?",[organizationId]).catch(()=>{});
    await sql.end();
  }
});
