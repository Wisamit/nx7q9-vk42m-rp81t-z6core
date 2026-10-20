import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { policyReviewIdentityScope, sameLiveScalarIdentity,
  sameLiveClinicalReviewIdentity, sameLiveReferenceIntervalMedicalSnapshot
} from "../src/lib/catalog-policy-review-scope.ts";

test("Stage 61 MariaDB: staged identities fail closed on revoked branch and changed live department", {
  timeout: 45000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = {host:url.hostname,port:Number(url.port || 3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [writer, reviewer] = await Promise.all([
    mysql.createConnection(cfg), mysql.createConnection(cfg),
  ]);
  const org=randomUUID(),otherOrg=randomUUID(),branchA=randomUUID(),branchB=randomUUID();
  const deptA=randomUUID(),deptB=randomUUID(),testId=randomUUID(),unitId=randomUUID();
  const listId=randomUUID(),batch=randomUUID(),actor=randomUUID();
  const componentId=randomUUID(),intervalId=randomUUID();
  const ids=Array.from({length:5},()=>randomUUID());
  const prefix="S61"+org.slice(0,8);
  const write=(sql:string,params:(string|number|null)[])=>writer.execute(sql,params);
  try {
    for(const [id,code] of [[org,"A"],[otherOrg,"F"]])
      await write("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+code,"Stage61"]);
    for(const [id,code] of [[branchA,"A"],[branchB,"B"]])
      await write("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+code,"Stage61 Branch"]);
    for(const [id,branch,code] of [[deptA,branchA,"D1"],[deptB,branchB,"D2"]])
      await write("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,org,branch,prefix+code,"Stage61 Department"]);
    await write("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [testId,org,deptA,prefix+"T","Stage61 Test"]);
    await write("INSERT INTO units(id,organization_id,code,symbol,updated_at) VALUES(?,?,?,?,NOW(3))",
      [unitId,org,prefix+"U","mg/dL"]);
    await write("INSERT INTO test_components(id,test_id,code,name_en,unit_id,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [componentId,testId,prefix+"C","Stage61 Component",unitId]);
    await write("INSERT INTO reference_intervals(id,component_id,branch_id,effective_from,approval_status,status,low_value,high_value,critical_low,critical_high,normal_text_en,updated_at) VALUES(?,?,?,'2026-01-01','APPROVED','ACTIVE',3.100000,7.200000,2.000000,9.000000,'Synthetic range',NOW(3))",
      [intervalId,componentId,branchA]);
    await write("INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES(?,?,?,?,'BRANCH',?,'AED','2025-01-01',NOW(3))",
      [listId,org,prefix+"P","Stage61 List",branchB]);
    await write("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor,org,prefix+"USER","Stage61 Author"]);
    await write("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage61.json',?,'DRAFT',?,NOW(3))",
      [batch,org,"f".repeat(64),actor]);
    const rows = [
      {entityType:"TEST",id:testId,normalized:{id:testId,code:prefix+"T",
        nameEn:"Stage61 Test",departmentId:deptA,status:"ACTIVE"}},
      {entityType:"UNIT",id:unitId,normalized:{id:unitId,code:prefix+"U",
        symbol:"mg/dL",status:"ACTIVE"}},
      {entityType:"PRICE_LIST",id:listId,normalized:{
        id:listId,scopeType:"BRANCH",branchId:branchB}},
    ];
    for (const [i,row] of rows.entries()) await write(
      "INSERT INTO catalog_import_rows(id,batch_id,\u0060row_number\u0060,entity_type,status,legacy_key,source_data,normalized_data,validation_issues,updated_at) VALUES(?,?,?,?,'WARNING',?,?,?,?,NOW(3))",
      [ids[i],batch,i+1,row.entityType,row.id,JSON.stringify(row.entityType==="PRICE_LIST"
        ? {id:row.id,code:prefix+"P",currency:"AED",scopeType:"BRANCH",
          branchId:branchB,status:"ACTIVE",sourceId:null,referrerId:null,
          clientId:null,contractId:null}
        : row.entityType==="TEST"
          ? {id:row.id,code:prefix+"T",nameEn:"Stage61 Test",departmentId:deptA,status:"ACTIVE"}
          : {id:row.id,code:prefix+"U",symbol:"mg/dL",status:"ACTIVE"}),
        JSON.stringify(row.entityType==="PRICE_LIST"
          ? {...row.normalized,code:prefix+"P",currency:"AED",status:"ACTIVE"}
          : row.normalized),JSON.stringify([{severity:"WARNING",code:"REVIEW_ONLY"}])]);
    const date="2026-01-01T00:00:00.000Z";
    const medicalSnapshot={
      methodId:null,analyzerId:null,specimenTypeId:null,sex:"ANY",
      ageFrom:null,ageTo:null,ageUnit:null,pregnancyStatus:null,
      gestationalAgeFromWeeks:null,gestationalAgeToWeeks:null,
      populationCode:null,lowValue:"3.100000",highValue:"7.200000",
      normalTextEn:"Synthetic range",normalTextAr:null,
      criticalLow:"2.000000",criticalHigh:"9.000000",
      source:null,notes:null,effectiveTo:null,approvedAt:null,retiredAt:null,
    };
    const clinicalRows=[
      {type:"COMPONENT",source:{id:componentId,code:prefix+"C",
        nameEn:"Stage61 Component",testId,unitId,status:"ACTIVE",
        test:{code:prefix+"T"}},
        normalized:{id:componentId,code:prefix+"C",nameEn:"Stage61 Component",
          testId,unitId,testCode:prefix+"T",status:"ACTIVE"}},
      {type:"REFERENCE_INTERVAL",source:{id:intervalId,componentId,
        branchId:branchA,effectiveFrom:date,approvalStatus:"APPROVED",
        status:"ACTIVE",...medicalSnapshot,
        component:{code:prefix+"C",test:{code:prefix+"T"}}},
        normalized:{id:intervalId,componentId,componentCode:prefix+"C",
          testCode:prefix+"T",branchId:branchA,effectiveFrom:date,
          approvalStatus:"APPROVED",status:"ACTIVE"}},
    ];
    for(const [i,row] of clinicalRows.entries())
      await write("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES(?,?,? ,?,'WARNING',?,?,NOW(3))",
        [ids[i+3],batch,i+4,row.type,JSON.stringify(row.source),
          JSON.stringify(row.normalized)]);
    const [staged]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT entity_type AS entityType,source_data AS sourceData,normalized_data AS normalizedData,status,imported_entity_id AS importedEntityId FROM catalog_import_rows WHERE batch_id=? ORDER BY \u0060row_number\u0060",
      [batch]);
    const decoded=staged.map(row=>({
      entityType:String(row.entityType),
      sourceData:typeof row.sourceData==="string"?JSON.parse(row.sourceData):row.sourceData,
      normalizedData:typeof row.normalizedData==="string"?JSON.parse(row.normalizedData):row.normalizedData,
      status:String(row.status), importedEntityId:row.importedEntityId as string|null,
    }));
    assert.deepEqual(policyReviewIdentityScope(decoded,new Set([branchA])),{
      ok:false,error:"policy_review_batch_scope_changed",
    });
    const permitted=policyReviewIdentityScope(decoded,new Set([branchA,branchB]));
    assert.equal(permitted.ok,true);
    // Mutating a persisted normalized identity must fail before any reviewer
    // evidence can be accepted, even while every live master stays in scope.
    const [before]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT normalized_data FROM catalog_import_rows WHERE id=?",[ids[0]]);
    const parse=(v:unknown)=>typeof v==="string"?JSON.parse(v):v;
    const tampered={...parse(before[0].normalized_data),nameEn:"Forged test"};
    await write("UPDATE catalog_import_rows SET normalized_data=? WHERE id=?",
      [JSON.stringify(tampered),ids[0]]);
    const [changed]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT entity_type AS entityType,source_data AS sourceData,normalized_data AS normalizedData,status,imported_entity_id AS importedEntityId FROM catalog_import_rows WHERE batch_id=? ORDER BY `row_number`",[batch]);
    const forged=changed.map(row=>({entityType:String(row.entityType),
      sourceData:parse(row.sourceData),normalizedData:parse(row.normalizedData),
      status:String(row.status),importedEntityId:row.importedEntityId as string|null}));
    assert.deepEqual(policyReviewIdentityScope(forged,new Set([branchA,branchB])),{
      ok:false,error:"policy_review_source_integrity_error",
    });
    await write("UPDATE catalog_import_rows SET normalized_data=? WHERE id=?",
      [JSON.stringify(parse(before[0].normalized_data)),ids[0]]);
    // Independent MariaDB reader checks the actual fields used by the
    // reviewer snapshot parity guard, not only an immutable UUID.
    const liveMatches=async()=>{
      const [tests]=await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT id,code,name_en AS nameEn,department_id AS departmentId,status FROM lab_tests WHERE id=? AND organization_id=?",
        [testId,org]);
      const [units]=await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT id,code,symbol,status FROM units WHERE id=? AND organization_id=?",
        [unitId,org]);
      return tests.length===1 && units.length===1 &&
        sameLiveScalarIdentity("TEST",decoded[0].normalizedData,tests[0]) &&
        sameLiveScalarIdentity("UNIT",decoded[1].normalizedData,units[0]);
    };
    assert.equal(await liveMatches(),true);
    await write("UPDATE lab_tests SET name_en=? WHERE id=?",["Changed after staging",testId]);
    assert.equal(await liveMatches(),false);
    await write("UPDATE lab_tests SET name_en=? WHERE id=?",["Stage61 Test",testId]);
    await write("UPDATE units SET symbol=? WHERE id=?",["mmol/L",unitId]);
    assert.equal(await liveMatches(),false);
    await write("UPDATE units SET symbol=? WHERE id=?",["mg/dL",unitId]);
    assert.equal(await liveMatches(),true);
    // Real MariaDB rows, independent writer/reader connections: same IDs but
    // changed component and interval review identity must refuse attestation.
    const liveClinical=async()=>{
      const [components]=await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT c.id,c.test_id AS testId,c.unit_id AS unitId,c.code,c.name_en AS nameEn,c.status,t.code AS testCode FROM test_components c JOIN lab_tests t ON t.id=c.test_id WHERE c.id=? AND t.organization_id=?",
        [componentId,org]);
      const [intervals]=await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT r.id,r.component_id AS componentId,r.branch_id AS branchId,r.effective_from AS effectiveFrom,r.approval_status AS approvalStatus,r.status,c.code AS componentCode,t.code AS testCode,r.method_id AS methodId,r.analyzer_id AS analyzerId,r.specimen_type_id AS specimenTypeId,r.sex,r.age_from AS ageFrom,r.age_to AS ageTo,r.age_unit AS ageUnit,r.pregnancy_status AS pregnancyStatus,r.gestational_age_from_weeks AS gestationalAgeFromWeeks,r.gestational_age_to_weeks AS gestationalAgeToWeeks,r.population_code AS populationCode,r.low_value AS lowValue,r.high_value AS highValue,r.normal_text_en AS normalTextEn,r.normal_text_ar AS normalTextAr,r.critical_low AS criticalLow,r.critical_high AS criticalHigh,r.`source` AS source,r.notes,r.effective_to AS effectiveTo,r.approved_at AS approvedAt,r.retired_at AS retiredAt FROM reference_intervals r JOIN test_components c ON c.id=r.component_id JOIN lab_tests t ON t.id=c.test_id WHERE r.id=? AND t.organization_id=?",
        [intervalId,org]);
      return components.length===1 && intervals.length===1 &&
        sameLiveClinicalReviewIdentity("COMPONENT",decoded[3].normalizedData,
          {...components[0],test:{code:components[0].testCode}}) &&
        sameLiveClinicalReviewIdentity("REFERENCE_INTERVAL",
          decoded[4].normalizedData,{
            ...intervals[0],component:{code:intervals[0].componentCode,
              test:{code:intervals[0].testCode}},
          }) &&
        sameLiveReferenceIntervalMedicalSnapshot(
          decoded[4].sourceData,intervals[0]);
    };
    assert.equal(await liveClinical(),true);
    await write("UPDATE test_components SET name_en=? WHERE id=?",
      ["Changed after staging",componentId]);
    assert.equal(await liveClinical(),false);
    await write("UPDATE test_components SET name_en=? WHERE id=?",
      ["Stage61 Component",componentId]);
    await write("UPDATE test_components SET unit_id=NULL WHERE id=?",[componentId]);
    assert.equal(await liveClinical(),false);
    await write("UPDATE test_components SET unit_id=? WHERE id=?",[unitId,componentId]);
    await write("UPDATE reference_intervals SET approval_status='RETIRED' WHERE id=?",[intervalId]);
    assert.equal(await liveClinical(),false);
    await write("UPDATE reference_intervals SET approval_status='APPROVED' WHERE id=?",[intervalId]);
    await write("UPDATE reference_intervals SET effective_from='2026-02-01' WHERE id=?",[intervalId]);
    assert.equal(await liveClinical(),false);
    await write("UPDATE reference_intervals SET effective_from='2026-01-01' WHERE id=?",[intervalId]);
    assert.equal(await liveClinical(),true);
    // Numeric and applicability changes leave the UUID and scope untouched.
    await write("UPDATE reference_intervals SET low_value=3.100001 WHERE id=?",[intervalId]);
    assert.equal(await liveClinical(),false);
    await write("UPDATE reference_intervals SET low_value=3.100000 WHERE id=?",[intervalId]);
    await write("UPDATE reference_intervals SET critical_high=9.000001 WHERE id=?",[intervalId]);
    assert.equal(await liveClinical(),false);
    await write("UPDATE reference_intervals SET critical_high=9.000000 WHERE id=?",[intervalId]);
    await write("UPDATE reference_intervals SET sex='FEMALE' WHERE id=?",[intervalId]);
    assert.equal(await liveClinical(),false);
    await write("UPDATE reference_intervals SET sex='ANY' WHERE id=?",[intervalId]);
    await write("UPDATE reference_intervals SET age_from=1.000 WHERE id=?",[intervalId]);
    assert.equal(await liveClinical(),false);
    await write("UPDATE reference_intervals SET age_from=NULL WHERE id=?",[intervalId]);
    await write("UPDATE reference_intervals SET normal_text_en='Tampered range' WHERE id=?",[intervalId]);
    assert.equal(await liveClinical(),false);
    await write("UPDATE reference_intervals SET normal_text_en='Synthetic range' WHERE id=?",[intervalId]);
    await write("UPDATE reference_intervals SET effective_to='2026-03-01' WHERE id=?",[intervalId]);
    assert.equal(await liveClinical(),false);
    await write("UPDATE reference_intervals SET effective_to=NULL WHERE id=?",[intervalId]);
    assert.equal(await liveClinical(),true);
    const [authorized]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT t.id FROM lab_tests t JOIN departments d ON d.id=t.department_id WHERE t.organization_id=? AND t.id=? AND d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?)",
      [org,testId,branchA]);
    assert.equal(authorized.length,1);
    await write("UPDATE lab_tests SET department_id=?,updated_at=NOW(3) WHERE id=?",
      [deptB,testId]);
    const [revoked]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT t.id FROM lab_tests t JOIN departments d ON d.id=t.department_id WHERE t.organization_id=? AND t.id=? AND d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?)",
      [org,testId,branchA]);
    assert.equal(revoked.length,0);
    const [foreign]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=?",[testId,otherOrg]);
    assert.equal(foreign.length,0);
    const [notApplied]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM catalog_import_rows WHERE batch_id=? AND imported_entity_id IS NOT NULL",
      [batch]);
    assert.equal(Number(notApplied[0].n),0);
  } finally {
    await writer.rollback().catch(()=>{});
    await write("DELETE FROM catalog_import_rows WHERE batch_id=?",[batch]).catch(()=>{});
    await write("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await write("DELETE FROM price_lists WHERE id=?",[listId]).catch(()=>{});
    await write("DELETE FROM reference_intervals WHERE id=?",[intervalId]).catch(()=>{});
    await write("DELETE FROM test_components WHERE id=?",[componentId]).catch(()=>{});
    await write("DELETE FROM lab_tests WHERE id=?",[testId]).catch(()=>{});
    await write("DELETE FROM units WHERE id=?",[unitId]).catch(()=>{});
    await write("DELETE FROM departments WHERE id IN (?,?)",[deptA,deptB]).catch(()=>{});
    await write("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
    await write("DELETE FROM branches WHERE id IN (?,?)",[branchA,branchB]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id IN (?,?)",[org,otherOrg]).catch(()=>{});
    await Promise.all([writer.end(),reviewer.end()]);
  }
});
