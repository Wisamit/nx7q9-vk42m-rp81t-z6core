import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  currentReportResultPointers, resultMatchesCurrentReportPointer,
} from "../src/lib/patient-history.ts";
import {
  publishedHistoryEvidence, resultMatchesPublishedHistory, publishedNumericValue,
} from "../src/lib/patient-history-published.ts";
import { clinicalTrendWindow, EXTENDED_TREND_REPORT_LIMIT } from "../src/lib/patient-history-trend-window.ts";

test("Stage 75 MariaDB: extended window finds older authenticated reports without branch/tenant leakage",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),
    restrictedBranch=randomUUID(),foreignBranch=randomUUID(),staff=randomUUID(),
    foreignStaff=randomUUID(),patient=randomUUID(),foreignPatient=randomUUID(),
    testId=randomUUID();
  const prefix="H75"+org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  const records:Array<{orderId:string;resultId:string;valueId:string;index:number;reportId:string}>=[];
  async function write(table:string,id:string,sql:string,params:Array<string|number|null>){
    await writer.execute(sql,params);
    cleanup.unshift({table,id});
  }
  const decode=(v:unknown)=>typeof v==="string"?JSON.parse(v):v;
  async function issue(i:number,tenant:string,patientId:string,orderedAtBranch:string,
    performedBranch:string,actor:string,reportStatus:"FINAL"|"RETRACTED"){
    const orderId=randomUUID(),itemId=randomUUID(),resultId=randomUUID(),valueId=randomUUID();
    const reportId=randomUUID(),versionId=randomUUID();
    const code="R"+String(i).padStart(3,"0");
    const date="2026-01-"+String(i+1).padStart(2,"0")+" 09:00:00";
    await write("orders",orderId,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,ordered_at,updated_at) VALUES(?,?,?,?,?,?,?,NOW(3))",
      [orderId,tenant,prefix+code,orderedAtBranch,patientId,actor,date]);
    await write("order_items",itemId,
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
      [itemId,orderId,testId,"HB","Hemoglobin"]);
    await write("laboratory_results",resultId,
      "INSERT INTO laboratory_results(id,organization_id,order_item_id,performing_branch_id,version,status,entered_by_user_id,updated_at) VALUES(?,?,?,?,1,'RELEASED',?,NOW(3))",
      [resultId,tenant,itemId,performedBranch,actor]);
    const value=(10+i/10).toFixed(1);
    await write("laboratory_result_values",valueId,
      "INSERT INTO laboratory_result_values(id,result_id,component_code_snapshot,component_name_en_snapshot,result_type_snapshot,display_value,value_numeric,unit_snapshot,flag,is_critical,reference_low_snapshot,reference_high_snapshot,updated_at) VALUES(?,?,'HB','Hemoglobin','NUMERIC',?,?,'g/dL','NORMAL',0,10,18,NOW(3))",
      [valueId,resultId,value,value]);
    await write("diagnostic_reports",reportId,
      "INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) VALUES(?,?,?,1,NOW(3))",
      [reportId,tenant,orderId]);
    const frozen={
      organization:{id:tenant},branch:{id:orderedAtBranch},patient:{id:patientId},
      order:{id:orderId,accessionNumber:prefix+code},results:[{
      resultId,orderItemId:itemId,resultVersion:1,testId,methodId:null,analyzer:null,
      performingBranch:{id:performedBranch},
      values:[{componentId:null,componentCode:"HB",componentNameEn:"Hemoglobin",
        componentNameAr:null,displayValue:value,unit:"g/dL",flag:"NORMAL",isCritical:false,
        referenceLow:"10",referenceHigh:"18",referenceTextEn:null,referenceTextAr:null}],
    }]};
    await write("diagnostic_report_versions",versionId,
      "INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id,issued_at) VALUES(?,?,1,?,?,?,?,?,?,?)",
      [versionId,reportId,reportStatus,performedBranch,JSON.stringify(frozen),
        JSON.stringify([{resultId,orderItemId:itemId,resultVersion:1}]),randomUUID(),actor,date]);
    records.push({index:i,orderId,resultId,valueId,reportId});
  }
  async function reportEvidence(tenant:string,person:string,allowedBranch:string,take:number){
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT o.id AS order_id,o.patient_id,o.organization_id,o.accession_number,o.ordering_branch_id,"+
      "d.current_version,v.version,v.status,v.content_snapshot,v.result_version_snapshot "+
      "FROM diagnostic_reports d JOIN orders o ON o.id=d.order_id "+
      "JOIN diagnostic_report_versions v ON v.report_id=d.id AND v.version=d.current_version "+
      "WHERE d.organization_id=? AND o.organization_id=? AND o.patient_id=? AND "+
      "(o.ordering_branch_id=? OR EXISTS (SELECT 1 FROM order_items oi "+
      "JOIN laboratory_results lr ON lr.order_item_id=oi.id "+
      "WHERE oi.order_id=o.id AND lr.organization_id=? "+
      "AND lr.performing_branch_id=? AND lr.status IN ('RELEASED','AMENDED'))) "+
      "ORDER BY o.ordered_at DESC,d.id DESC LIMIT ?",
      [tenant,tenant,person,allowedBranch,tenant,allowedBranch,take]);
    return rows.map(row=>({
      organizationId:String(row.organization_id),orderId:String(row.order_id),
      order:{id:String(row.order_id),patientId:String(row.patient_id),
        accessionNumber:String(row.accession_number),
        orderingBranchId:String(row.ordering_branch_id)},
      currentVersion:Number(row.current_version),
      versions:[{version:Number(row.version),status:String(row.status),
        contentSnapshot:decode(row.content_snapshot),resultVersionSnapshot:decode(row.result_version_snapshot)}]}));
  }
  async function publishedVisible(reports:Awaited<ReturnType<typeof reportEvidence>>){
    const pointers=currentReportResultPointers(reports), evidence=publishedHistoryEvidence(reports);
    if(!pointers.size)return [];
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT lr.id,lr.order_item_id,lr.version,lr.performing_branch_id,lr.method_id,"+
      "lr.analyzer_code_snapshot,oi.order_id,oi.test_id,o.patient_id,o.organization_id,"+
      "o.accession_number,o.ordering_branch_id,v.component_id,v.component_code_snapshot,"+
      "v.component_name_en_snapshot,v.component_name_ar_snapshot,v.report_name_en_snapshot,"+
      "v.report_name_ar_snapshot,v.display_value,v.value_numeric,v.unit_snapshot,v.flag,v.is_critical,"+
      "v.reference_low_snapshot,v.reference_high_snapshot,v.reference_text_en_snapshot,v.reference_text_ar_snapshot "+
      "FROM laboratory_results lr JOIN order_items oi ON oi.id=lr.order_item_id "+
      "JOIN orders o ON o.id=oi.order_id JOIN laboratory_result_values v ON v.result_id=lr.id "+
      "WHERE lr.organization_id=? AND o.organization_id=? AND o.patient_id=? "+
      "AND lr.performing_branch_id=? AND lr.status IN ('RELEASED','AMENDED') AND lr.id IN ("+
      [...pointers].map(()=>"?").join(",")+")",
      [org,org,patient,branch,...pointers.keys()]);
    return rows.filter(row=>{
      const observed={
        id:String(row.id),orderItemId:String(row.order_item_id),version:Number(row.version),
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
          referenceLowSnapshot:row.reference_low_snapshot===null?null:{
            toString:()=>String(Number(row.reference_low_snapshot))},
          referenceHighSnapshot:row.reference_high_snapshot===null?null:{
            toString:()=>String(Number(row.reference_high_snapshot))},
          referenceTextEnSnapshot:row.reference_text_en_snapshot,
          referenceTextArSnapshot:row.reference_text_ar_snapshot}],
      };
      return resultMatchesCurrentReportPointer(observed,pointers) &&
        resultMatchesPublishedHistory(observed,evidence) &&
        publishedNumericValue(String(row.display_value),row.value_numeric!==null)!==null;
    }).map(row=>String(row.id));
  }
  try{
    for(const [id,code] of [[org,"A"],[foreignOrg,"F"]])
      await write("organizations",id,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+code,"Stage75 Tenant"]);
    for(const [id,tenant,code] of [[branch,org,"A"],[restrictedBranch,org,"B"],[foreignBranch,foreignOrg,"F"]])
      await write("branches",id,"INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage75 Branch"]);
    for(const [id,tenant,code] of [[staff,org,"A"],[foreignStaff,foreignOrg,"F"]])
      await write("users",id,"INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage75 Staff"]);
    for(const [id,tenant,code] of [[patient,org,"A"],[foreignPatient,foreignOrg,"F"]])
      await write("patients",id,"INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage75 Patient","stage75 patient"]);
    // Use a shared tenant test master for both test tenants only in this synthetic
    // fixture, since relational order-item ID equality does not expose test master.
    await write("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,prefix+"T","Hemoglobin"]);
    for(let i=0;i<24;i++){
      await issue(i,org,patient,i===0?restrictedBranch:branch,branch,staff,"FINAL");
    }
    await issue(24,org,patient,restrictedBranch,restrictedBranch,staff,"FINAL");
    await issue(25,org,patient,branch,branch,staff,"RETRACTED");
    await issue(26,foreignOrg,foreignPatient,foreignBranch,foreignBranch,foreignStaff,"FINAL");

    const reports=await reportEvidence(org,patient,branch,EXTENDED_TREND_REPORT_LIMIT+1);
    assert.equal(reports.length,25);
    const ordinary=clinicalTrendWindow(reports.slice(0,21),false);
    const wide=clinicalTrendWindow(reports,true);
    assert.equal(ordinary.page.rows.length,20);
    assert.equal(ordinary.page.hasNext,true);
    assert.equal(wide.chartEvidence.length,25);
    assert.equal(wide.truncated,false);
    const visibleWide=await publishedVisible(wide.chartEvidence);
    const visiblePage=await publishedVisible(ordinary.chartEvidence);
    // One restricted report and one retracted version must never be disclosed.
    assert.equal(visibleWide.length,24);
    assert.equal(visiblePage.length,19);
    const older=records.find(item=>item.index===0)!;
    assert.equal(visibleWide.includes(older.resultId),true);
    assert.equal(visiblePage.includes(older.resultId),false);
    assert.deepEqual(await reportEvidence(foreignOrg,patient,foreignBranch,251),[]);
    assert.deepEqual(await reportEvidence(org,foreignPatient,branch,251),[]);

    // Corrupt database observation cannot leak a new value absent from the
    // immutable published report, even in an expanded trend window.
    await writer.execute("UPDATE laboratory_result_values SET display_value='900' WHERE id=?",[older.valueId]);
    assert.equal((await publishedVisible(wide.chartEvidence)).includes(older.resultId),false);
  }finally{
    for(const row of cleanup)await writer.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
