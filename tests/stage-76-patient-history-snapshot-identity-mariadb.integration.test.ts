import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { currentReportResultPointers, resultMatchesCurrentReportPointer } from "../src/lib/patient-history.ts";
import { publishedHistoryEvidence, resultMatchesPublishedHistory } from "../src/lib/patient-history-published.ts";

test("Stage 76 MariaDB: immutable original patient/tenant/ordering branch attest current history including merged aliases", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [writer, reader] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
  const org = randomUUID(), otherOrg = randomUUID(), branchA = randomUUID(),
    branchB = randomUUID(), foreignBranch = randomUUID(), actor = randomUUID(),
    foreignActor = randomUUID(), canonical = randomUUID(), alias = randomUUID(),
    otherPatient = randomUUID(), foreignPatient = randomUUID(), testId = randomUUID();
  const prefix = "H76" + org.slice(0, 8);
  const cleanup: Array<{ table: string; id: string }> = [];
  const testReports: Record<string,{ reportId: string; resultId: string; orderId: string }> = {};

  async function insert(table: string, id: string, sql: string, params: Array<string | number | null>) {
    await writer.execute(sql, params);
    cleanup.unshift({ table, id });
  }
  const decode = (value: unknown) => typeof value === "string" ? JSON.parse(value) : value;
  async function make(label: string, tenant: string, patientId: string, orderBranch: string,
    performingBranch: string, issuer: string, corrupt: string | null = null,
    status = "FINAL") {
    const orderId = randomUUID(), itemId = randomUUID(), resultId = randomUUID(),
      valueId = randomUUID(), reportId = randomUUID(), versionId = randomUUID();
    const accession = prefix + "-ACC-" + label;
    await insert("orders", orderId,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [orderId,tenant,accession,orderBranch,patientId,issuer]);
    await insert("order_items",itemId,
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
      [itemId,orderId,testId,"HB","Hemoglobin"]);
    await insert("laboratory_results",resultId,
      "INSERT INTO laboratory_results(id,organization_id,order_item_id,performing_branch_id,version,status,entered_by_user_id,updated_at) VALUES(?,?,?,?,1,'RELEASED',?,NOW(3))",
      [resultId,tenant,itemId,performingBranch,issuer]);
    await insert("laboratory_result_values",valueId,
      "INSERT INTO laboratory_result_values(id,result_id,component_code_snapshot,component_name_en_snapshot,result_type_snapshot,display_value,unit_snapshot,flag,is_critical,reference_low_snapshot,reference_high_snapshot,updated_at) VALUES(?,?,'HB','Hemoglobin','NUMERIC','13.5','g/dL','NORMAL',0,12,16,NOW(3))",
      [valueId,resultId]);
    await insert("diagnostic_reports",reportId,
      "INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) VALUES(?,?,?,1,NOW(3))",
      [reportId,tenant,orderId]);
    const frozen = {
      organization:{id:corrupt==="org"?otherOrg:tenant},
      branch:{id:corrupt==="ordering_branch"?performingBranch:orderBranch},
      patient:{id:corrupt==="patient"?otherPatient:patientId},
      order:{id:orderId,accessionNumber:corrupt==="accession"?"BAD-ACC":accession},
      results:[{
        orderItemId:itemId,resultId,resultVersion:1,testId,
        performingBranch:{id:performingBranch},methodId:null,analyzer:null,
        values:[{componentId:null,componentCode:"HB",componentNameEn:"Hemoglobin",componentNameAr:null,
          displayValue:"13.5",unit:"g/dL",flag:"NORMAL",isCritical:false,
          referenceLow:"12",referenceHigh:"16",referenceTextEn:null,referenceTextAr:null}],
      }],
    };
    await insert("diagnostic_report_versions",versionId,
      "INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id) VALUES(?,?,1,?,?,?,?,?,?)",
      [versionId,reportId,status,performingBranch,JSON.stringify(frozen),
        JSON.stringify([{resultId,orderItemId:itemId,resultVersion:1}]),randomUUID(),issuer]);
    testReports[label]={reportId,resultId,orderId};
  }
  async function visible(label:string, scopedOrg:string, allowedPerformingBranch:string) {
    const ids = testReports[label];
    const [reportRows] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT d.organization_id,d.order_id,o.patient_id,o.accession_number,o.ordering_branch_id,"+
      "d.current_version,v.version,v.status,v.content_snapshot,v.result_version_snapshot "+
      "FROM diagnostic_reports d JOIN orders o ON o.id=d.order_id "+
      "JOIN diagnostic_report_versions v ON v.report_id=d.id AND v.version=d.current_version "+
      "WHERE d.id=? AND d.organization_id=? AND o.organization_id=?",
      [ids.reportId,scopedOrg,scopedOrg]);
    if (!reportRows.length) return [];
    const r=reportRows[0];
    const reports=[{
      organizationId:String(r.organization_id),orderId:String(r.order_id),
      order:{id:String(r.order_id),patientId:String(r.patient_id),
        accessionNumber:String(r.accession_number),orderingBranchId:String(r.ordering_branch_id)},
      currentVersion:Number(r.current_version),
      versions:[{version:Number(r.version),status:String(r.status),
        contentSnapshot:decode(r.content_snapshot),resultVersionSnapshot:decode(r.result_version_snapshot)}],
    }];
    const pointers=currentReportResultPointers(reports);
    const evidence=publishedHistoryEvidence(reports);
    if(!pointers.size || !evidence.size)return [];
    const [rows] = await reader.execute<mysql.RowDataPacket[]>(
      "SELECT lr.id,lr.order_item_id,lr.version,lr.performing_branch_id,lr.method_id,"+
      "lr.analyzer_code_snapshot,oi.test_id,o.id AS order_id,o.organization_id,"+
      "o.patient_id,o.accession_number,o.ordering_branch_id,v.component_id,v.component_code_snapshot,"+
      "v.component_name_en_snapshot,v.component_name_ar_snapshot,v.report_name_en_snapshot,"+
      "v.report_name_ar_snapshot,v.display_value,v.unit_snapshot,v.flag,v.is_critical,"+
      "v.reference_low_snapshot,v.reference_high_snapshot,v.reference_text_en_snapshot,v.reference_text_ar_snapshot "+
      "FROM laboratory_results lr JOIN order_items oi ON oi.id=lr.order_item_id "+
      "JOIN orders o ON o.id=oi.order_id JOIN laboratory_result_values v ON v.result_id=lr.id "+
      "WHERE lr.id=? AND lr.organization_id=? AND o.organization_id=? "+
      "AND lr.performing_branch_id=? AND lr.status IN ('RELEASED','AMENDED')",
      [ids.resultId,scopedOrg,scopedOrg,allowedPerformingBranch]);
    return rows.filter(row=>{
      const candidate={
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
          referenceLowSnapshot:row.reference_low_snapshot===null?null:{toString:()=>String(Number(row.reference_low_snapshot))},
          referenceHighSnapshot:row.reference_high_snapshot===null?null:{toString:()=>String(Number(row.reference_high_snapshot))},
          referenceTextEnSnapshot:row.reference_text_en_snapshot,referenceTextArSnapshot:row.reference_text_ar_snapshot}],
      };
      return resultMatchesCurrentReportPointer(candidate,pointers) &&
        resultMatchesPublishedHistory(candidate,evidence);
    }).map(x=>String(x.id));
  }
  try{
    for(const [id,code] of [[org,"A"],[otherOrg,"X"]])
      await insert("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+code,"Stage76 Tenant"]);
    for(const [id,tenant,code] of [[branchA,org,"A"],[branchB,org,"B"],[foreignBranch,otherOrg,"X"]])
      await insert("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage76 Branch"]);
    for(const [id,tenant,code] of [[actor,org,"A"],[foreignActor,otherOrg,"X"]])
      await insert("users",id,
        "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage76 User"]);
    const patientsToCreate: Array<[string, string, string, string | null]> = [
      [canonical,org,"C",null], [alias,org,"A",canonical],
      [otherPatient,org,"B",null], [foreignPatient,otherOrg,"X",null],
    ];
    for(const [id,tenant,code,mergedTo] of patientsToCreate){
      await insert("patients",id,
        "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,status,merged_into_patient_id,updated_at) VALUES(?,?,?,?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage76 Patient","stage76 patient",mergedTo?"INACTIVE":"ACTIVE",mergedTo]);
    }
    await insert("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,prefix+"T","Hemoglobin"]);
    await make("GOOD",org,alias,branchA,branchB,actor);
    await make("PAT",org,alias,branchA,branchB,actor,"patient");
    await make("ACC",org,alias,branchA,branchB,actor,"accession");
    await make("BRANCH",org,alias,branchA,branchB,actor,"ordering_branch");
    await make("ORG",org,alias,branchA,branchB,actor,"org");
    await make("WITHDRAWN",org,alias,branchA,branchB,actor,null,"RETRACTED");
    await make("FOREIGN",otherOrg,foreignPatient,foreignBranch,foreignBranch,foreignActor);

    assert.deepEqual(await visible("GOOD",org,branchB),[testReports.GOOD.resultId]);
    for(const label of ["PAT","ACC","BRANCH","ORG","WITHDRAWN"]){
      assert.deepEqual(await visible(label,org,branchB),[],label);
    }
    assert.deepEqual(await visible("GOOD",org,branchA),[]);
    assert.deepEqual(await visible("FOREIGN",org,branchB),[]);
    assert.deepEqual(await visible("FOREIGN",otherOrg,branchB),[]);
    assert.deepEqual(await visible("FOREIGN",otherOrg,foreignBranch),[testReports.FOREIGN.resultId]);
  }finally{
    for(const row of cleanup)
      await writer.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
