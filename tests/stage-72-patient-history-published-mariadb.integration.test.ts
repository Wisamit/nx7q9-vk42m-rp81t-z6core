import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { publishedHistoryEvidence, resultMatchesPublishedHistory } from "../src/lib/patient-history-published.ts";

test("Stage 72 MariaDB: only authorized unchanged published result values survive history disclosure",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const config={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const ids=Array.from({length:12},()=>randomUUID());
  const [org,otherOrg,branch,otherBranch,actor,patient,testId,order,item,result,valueId,reportId]=ids;
  const versionId=randomUUID(),prefix="H72"+org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  async function write(table:string,id:string,sql:string,args:Array<string | number | null>){
    await writer.execute(sql,args);
    cleanup.unshift({table,id});
  }
  const frozen={
    organization:{id:org},branch:{id:branch},patient:{id:patient},
    order:{id:order,accessionNumber:prefix+"ACC"},
    results:[{resultId:result,orderItemId:item,resultVersion:1,testId,
      performingBranch:{id:branch},methodId:null,analyzer:null,
      values:[{componentId:null,componentCode:"HB",componentNameEn:"Hemoglobin",
        componentNameAr:null,displayValue:"13.5",unit:"g/dL",flag:"NORMAL",
        isCritical:false,referenceLow:"12",referenceHigh:"16",
        referenceTextEn:null,referenceTextAr:null}]}],
  };
  const pointer=[{resultId:result,orderItemId:item,resultVersion:1}];
  const decode=(x:unknown)=>typeof x==="string"?JSON.parse(x):x;
  async function readReport(){
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT d.organization_id,d.order_id,o.patient_id,o.accession_number,o.ordering_branch_id,"+
      "d.current_version,v.version,v.status,v.content_snapshot,v.result_version_snapshot "+
      "FROM diagnostic_reports d JOIN orders o ON o.id=d.order_id "+
      "JOIN diagnostic_report_versions v ON v.report_id=d.id "+
      "AND v.version=d.current_version WHERE d.id=? AND d.organization_id=?",
      [reportId,org]);
    return rows.map(x=>({organizationId:String(x.organization_id),
      orderId:String(x.order_id),
      order:{id:String(x.order_id),patientId:String(x.patient_id),
        accessionNumber:String(x.accession_number),
        orderingBranchId:String(x.ordering_branch_id)},
      currentVersion:Number(x.current_version),
      versions:[{version:Number(x.version),status:String(x.status),
        contentSnapshot:decode(x.content_snapshot),resultVersionSnapshot:decode(x.result_version_snapshot)}]}));
  }
  async function readResult(scopedOrg:string,scopedBranch:string){
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT r.id,r.order_item_id,r.version,r.performing_branch_id,r.method_id,r.analyzer_code_snapshot,"+
      "i.test_id,i.order_id,o.patient_id,o.organization_id,o.accession_number,o.ordering_branch_id,"+
      "v.component_id,v.component_code_snapshot,v.component_name_en_snapshot,"+
      "v.component_name_ar_snapshot,v.report_name_en_snapshot,v.report_name_ar_snapshot,"+
      "v.display_value,v.unit_snapshot,v.flag,v.is_critical,v.reference_low_snapshot,"+
      "v.reference_high_snapshot,v.reference_text_en_snapshot,v.reference_text_ar_snapshot "+
      "FROM laboratory_results r JOIN order_items i ON i.id=r.order_item_id "+
      "JOIN orders o ON o.id=i.order_id JOIN laboratory_result_values v ON v.result_id=r.id "+
      "WHERE r.id=? AND r.organization_id=? AND o.organization_id=? "+
      "AND r.performing_branch_id=? AND r.status IN ('RELEASED','AMENDED')",
      [result,scopedOrg,scopedOrg,scopedBranch]);
    return rows.map(x=>({
      id:String(x.id),orderItemId:String(x.order_item_id),version:Number(x.version),
      performingBranchId:String(x.performing_branch_id),methodId:x.method_id,
      analyzerCodeSnapshot:x.analyzer_code_snapshot,
      orderItem:{testId:String(x.test_id),order:{
        id:String(x.order_id),patientId:String(x.patient_id),
        organizationId:String(x.organization_id),accessionNumber:String(x.accession_number),
        orderingBranchId:String(x.ordering_branch_id)}},
      values:[{componentId:x.component_id,componentCodeSnapshot:String(x.component_code_snapshot),
        componentNameEnSnapshot:String(x.component_name_en_snapshot),
        componentNameArSnapshot:x.component_name_ar_snapshot,
        reportNameEnSnapshot:x.report_name_en_snapshot,reportNameArSnapshot:x.report_name_ar_snapshot,
        displayValue:String(x.display_value),unitSnapshot:x.unit_snapshot,flag:String(x.flag),
        isCritical:Boolean(x.is_critical),
        referenceLowSnapshot:x.reference_low_snapshot===null?null:{toString:()=>String(Number(x.reference_low_snapshot))},
        referenceHighSnapshot:x.reference_high_snapshot===null?null:{toString:()=>String(Number(x.reference_high_snapshot))},
        referenceTextEnSnapshot:x.reference_text_en_snapshot,referenceTextArSnapshot:x.reference_text_ar_snapshot}],
    }));
  }
  try{
    for(const [id,code] of [[org,"A"],[otherOrg,"B"]]){
      await write("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+code,"Stage72 Org"]);
    }
    for(const [id,tenant,code] of [[branch,org,"A"],[otherBranch,otherOrg,"B"]]){
      await write("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage72 Branch"]);
    }
    await write("users",actor,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor,org,prefix+"U","Stage72 Actor"]);
    await write("patients",patient,
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [patient,org,prefix+"P","Stage72 Patient","stage72 patient"]);
    await write("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,prefix+"T","Hemoglobin"]);
    await write("orders",order,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [order,org,prefix+"ACC",branch,patient,actor]);
    await write("order_items",item,
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
      [item,order,testId,prefix+"T","Hemoglobin"]);
    await write("laboratory_results",result,
      "INSERT INTO laboratory_results(id,organization_id,order_item_id,performing_branch_id,version,status,entered_by_user_id,updated_at) VALUES(?,?,?,?,1,'RELEASED',?,NOW(3))",
      [result,org,item,branch,actor]);
    await write("laboratory_result_values",valueId,
      "INSERT INTO laboratory_result_values(id,result_id,component_code_snapshot,component_name_en_snapshot,result_type_snapshot,display_value,unit_snapshot,flag,is_critical,reference_low_snapshot,reference_high_snapshot,updated_at) VALUES (?,?,'HB','Hemoglobin','NUMERIC','13.5','g/dL','NORMAL',0,12,16,NOW(3))",
      [valueId,result]);
    await write("diagnostic_reports",reportId,
      "INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) VALUES(?,?,?,1,NOW(3))",
      [reportId,org,order]);
    await write("diagnostic_report_versions",versionId,
      "INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id) VALUES(?,?,1,'FINAL',?,?,?,?,?)",
      [versionId,reportId,branch,JSON.stringify(frozen),JSON.stringify(pointer),prefix+"V",actor]);
    const evidence=publishedHistoryEvidence(await readReport());
    assert.equal(evidence.size,1);
    const rows=await readResult(org,branch);
    assert.equal(rows.length,1);
    assert.equal(resultMatchesPublishedHistory(rows[0],evidence),true);
    assert.deepEqual(await readResult(otherOrg,branch),[]);
    assert.deepEqual(await readResult(org,otherBranch),[]);

    await writer.execute("UPDATE laboratory_result_values SET display_value='16.2' WHERE id=?",[valueId]);
    assert.equal(resultMatchesPublishedHistory((await readResult(org,branch))[0],evidence),false);
    await writer.execute("UPDATE laboratory_result_values SET display_value='13.5',reference_high_snapshot=18 WHERE id=?",[valueId]);
    assert.equal(resultMatchesPublishedHistory((await readResult(org,branch))[0],evidence),false);
    await writer.execute("UPDATE laboratory_result_values SET reference_high_snapshot=16 WHERE id=?",[valueId]);
    assert.equal(resultMatchesPublishedHistory((await readResult(org,branch))[0],evidence),true);
    await writer.execute("UPDATE diagnostic_report_versions SET status='RETRACTED' WHERE id=?",[versionId]);
    assert.equal(publishedHistoryEvidence(await readReport()).size,0);
  }finally{
    for(const item of cleanup)
      await writer.execute("DELETE FROM "+item.table+" WHERE id=?",[item.id]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
