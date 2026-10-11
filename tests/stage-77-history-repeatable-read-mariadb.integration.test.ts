import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { currentReportResultPointers, resultMatchesCurrentReportPointer } from "../src/lib/patient-history.ts";
import { publishedHistoryEvidence, resultMatchesPublishedHistory } from "../src/lib/patient-history-published.ts";

test("Stage 77 MariaDB: amendment and retraction cannot mix issued report revisions with live clinical values", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [clinical, concurrent] = await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const [org,orderingBranch,performingBranch,actor,patient,testId,orderId,itemId,reportId] =
    Array.from({length:9},()=>randomUUID());
  const prefix="H77"+org.slice(0,8);
  const accession=prefix+"ACC";
  const cleanup:Array<{table:string,id:string}>=[];
  const decode=(x:unknown)=>typeof x==="string"?JSON.parse(x):x;
  async function insert(table:string,id:string,sql:string,params:Array<string|number|null>){
    await concurrent.execute(sql,params);
    cleanup.unshift({table,id});
  }
  async function insertRevision(version:number,status:"FINAL"|"AMENDED"|"RETRACTED",
    number:string|null){
    const resultId=number===null?null:randomUUID();
    const valueId=number===null?null:randomUUID();
    const versionId=randomUUID();
    if(resultId && valueId){
      await insert("laboratory_results",resultId,
        "INSERT INTO laboratory_results(id,organization_id,order_item_id,performing_branch_id,version,status,entered_by_user_id,updated_at) "+
        "VALUES(?,?,?,?,?,'RELEASED',?,NOW(3))",
        [resultId,org,itemId,performingBranch,version,actor]);
      await insert("laboratory_result_values",valueId,
        "INSERT INTO laboratory_result_values(id,result_id,component_code_snapshot,component_name_en_snapshot,result_type_snapshot,"+
        "display_value,value_numeric,unit_snapshot,flag,is_critical,reference_low_snapshot,reference_high_snapshot,updated_at) "+
        "VALUES(?,?,'HB','Hemoglobin','NUMERIC',?,?,'g/dL','NORMAL',0,12,16,NOW(3))",
        [valueId,resultId,number,number]);
    }
    const pointers=resultId?[{resultId,orderItemId:itemId,resultVersion:version}]:[];
    const snapshot={organization:{id:org},branch:{id:orderingBranch},
      patient:{id:patient},order:{id:orderId,accessionNumber:accession},results:
      resultId?[{resultId,orderItemId:itemId,resultVersion:version,testId,
        performingBranch:{id:performingBranch},methodId:null,analyzer:null,
        values:[{componentId:null,componentCode:"HB",componentNameEn:"Hemoglobin",
          componentNameAr:null,displayValue:number,unit:"g/dL",flag:"NORMAL",
          isCritical:false,referenceLow:"12",referenceHigh:"16",
          referenceTextEn:null,referenceTextAr:null}]}]:[]};
    await insert("diagnostic_report_versions",versionId,
      "INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,"+
      "result_version_snapshot,verification_token,issued_by_user_id,issued_at) "+
      "VALUES(?,?,?,?,?,?,?,?,?,NOW(3))",
      [versionId,reportId,version,status,performingBranch,
        JSON.stringify(snapshot),JSON.stringify(pointers),randomUUID(),actor]);
    return {resultId};
  }
  async function reportSnapshot(db:mysql.Connection) {
    const [rows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT d.organization_id,d.order_id,o.patient_id,o.accession_number,o.ordering_branch_id,"+
      "d.current_version,v.version,v.status,v.content_snapshot,v.result_version_snapshot "+
      "FROM diagnostic_reports d JOIN orders o ON o.id=d.order_id "+
      "JOIN diagnostic_report_versions v ON v.report_id=d.id AND v.version=d.current_version "+
      "WHERE d.id=? AND d.organization_id=? AND o.organization_id=?",
      [reportId,org,org]);
    if(rows.length!==1)throw Error("TEST_REPORT_NOT_FOUND");
    const r=rows[0];
    return {organizationId:String(r.organization_id),orderId:String(r.order_id),
      order:{id:String(r.order_id),patientId:String(r.patient_id),
        accessionNumber:String(r.accession_number),orderingBranchId:String(r.ordering_branch_id)},
      currentVersion:Number(r.current_version),
      versions:[{version:Number(r.version),status:String(r.status),
        resultVersionSnapshot:decode(r.result_version_snapshot),
        contentSnapshot:decode(r.content_snapshot)}]};
  }
  async function corroborated(db:mysql.Connection,report:Awaited<ReturnType<typeof reportSnapshot>>) {
    const pointers=currentReportResultPointers([report]);
    const evidence=publishedHistoryEvidence([report]);
    if(pointers.size===0)return [];
    const [rows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT r.id,r.order_item_id,r.version,r.performing_branch_id,r.method_id,r.analyzer_code_snapshot,"+
      "i.test_id,o.id AS order_id,o.organization_id,o.patient_id,o.accession_number,o.ordering_branch_id,"+
      "v.component_id,v.component_code_snapshot,v.component_name_en_snapshot,v.component_name_ar_snapshot,"+
      "v.report_name_en_snapshot,v.report_name_ar_snapshot,v.display_value,v.unit_snapshot,v.flag,v.is_critical,"+
      "v.reference_low_snapshot,v.reference_high_snapshot,v.reference_text_en_snapshot,v.reference_text_ar_snapshot "+
      "FROM laboratory_results r JOIN order_items i ON i.id=r.order_item_id JOIN orders o ON o.id=i.order_id "+
      "JOIN laboratory_result_values v ON v.result_id=r.id "+
      "WHERE r.organization_id=? AND o.organization_id=? AND r.performing_branch_id=? "+
      "AND o.patient_id=? AND r.status IN ('RELEASED','AMENDED') AND r.id IN ("+
      [...pointers.keys()].map(()=>"?").join(",")+")",
      [org,org,performingBranch,patient,...pointers.keys()]);
    return rows.filter(row=>{
      const candidate={id:String(row.id),orderItemId:String(row.order_item_id),version:Number(row.version),
        performingBranchId:String(row.performing_branch_id),methodId:row.method_id,
        analyzerCodeSnapshot:row.analyzer_code_snapshot,
        orderItem:{testId:String(row.test_id),order:{
          id:String(row.order_id),organizationId:String(row.organization_id),
          patientId:String(row.patient_id),accessionNumber:String(row.accession_number),
          orderingBranchId:String(row.ordering_branch_id)}},
        values:[{componentId:row.component_id,componentCodeSnapshot:String(row.component_code_snapshot),
          componentNameEnSnapshot:String(row.component_name_en_snapshot),
          componentNameArSnapshot:row.component_name_ar_snapshot,
          reportNameEnSnapshot:row.report_name_en_snapshot,reportNameArSnapshot:row.report_name_ar_snapshot,
          displayValue:String(row.display_value),unitSnapshot:row.unit_snapshot,flag:String(row.flag),
          isCritical:Boolean(row.is_critical),
          referenceLowSnapshot:row.reference_low_snapshot===null?null:{toString:()=>String(Number(row.reference_low_snapshot))},
          referenceHighSnapshot:row.reference_high_snapshot===null?null:{toString:()=>String(Number(row.reference_high_snapshot))},
          referenceTextEnSnapshot:row.reference_text_en_snapshot,referenceTextArSnapshot:row.reference_text_ar_snapshot}],
      };
      return resultMatchesCurrentReportPointer(candidate,pointers) &&
        resultMatchesPublishedHistory(candidate,evidence);
    }).map(row=>({id:String(row.id),display:String(row.display_value)}));
  }
  try{
    await insert("organizations",org,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,prefix+"ORG","Stage77 Tenant"]);
    for(const [id,code] of [[orderingBranch,"ORDER"],[performingBranch,"PERFORM"]])
      await insert("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+code,"Stage77 Branch"]);
    await insert("users",actor,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor,org,prefix+"U","Stage77 User"]);
    await insert("patients",patient,
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) "+
      "VALUES(?,?,?,?,?,NOW(3))",
      [patient,org,prefix+"P","Stage77 Patient","stage77 patient"]);
    await insert("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,prefix+"T","Hemoglobin"]);
    await insert("orders",orderId,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) "+
      "VALUES(?,?,?,?,?,?,NOW(3))",
      [orderId,org,accession,orderingBranch,patient,actor]);
    await insert("order_items",itemId,
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) "+
      "VALUES(?,?,?,?,?,'AED',NOW(3))",
      [itemId,orderId,testId,"HB","Hemoglobin"]);
    await insert("diagnostic_reports",reportId,
      "INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) "+
      "VALUES(?,?,?,1,NOW(3))",
      [reportId,org,orderId]);
    const v1=await insertRevision(1,"FINAL","13.5");
    await clinical.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await clinical.beginTransaction();
    const before=await reportSnapshot(clinical);
    assert.equal(before.currentVersion,1);

    // Legitimate append-only amendment commits on a second connection between
    // report evidence SELECT and live result SELECT on the reader.
    await concurrent.beginTransaction();
    const v2=await insertRevision(2,"AMENDED","14.5");
    await concurrent.execute("UPDATE diagnostic_reports SET current_version=2 WHERE id=?",[reportId]);
    await concurrent.commit();
    assert.deepEqual(await corroborated(clinical,before),[{id:v1.resultId,display:"13.5"}]);
    assert.equal((await reportSnapshot(clinical)).currentVersion,1);
    await clinical.commit();

    const afterAmend=await reportSnapshot(clinical);
    assert.equal(afterAmend.currentVersion,2);
    assert.deepEqual(await corroborated(clinical,afterAmend),[{id:v2.resultId,display:"14.5"}]);

    // Snapshot stays on version 2 when a released report is subsequently
    // retracted by publishing a new version; the next reader sees zero results.
    await clinical.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await clinical.beginTransaction();
    const beforeRetraction=await reportSnapshot(clinical);
    await concurrent.beginTransaction();
    await insertRevision(3,"RETRACTED",null);
    await concurrent.execute("UPDATE diagnostic_reports SET current_version=3 WHERE id=?",[reportId]);
    await concurrent.commit();
    assert.deepEqual(await corroborated(clinical,beforeRetraction),[{id:v2.resultId,display:"14.5"}]);
    await clinical.commit();

    const afterRetract=await reportSnapshot(clinical);
    assert.equal(afterRetract.currentVersion,3);
    assert.deepEqual(await corroborated(clinical,afterRetract),[]);
  } finally {
    await clinical.rollback().catch(()=>{});
    await concurrent.rollback().catch(()=>{});
    for(const row of cleanup)
      await concurrent.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([clinical.end(),concurrent.end()]);
  }
});
