import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { extractCurrentReportReadings, compareCurrentReportWithPrevious, type ReportComparisonEvidence } from "../src/lib/report-cumulative.ts";

test("Stage 74 MariaDB: frozen wrong-patient/order reports never contaminate cumulative values", {timeout:60000}, async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),outside=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),
    foreignBranch=randomUUID(),staff=randomUUID(),foreignStaff=randomUUID(),
    patient=randomUUID(),anotherPatient=randomUUID(),foreignPatient=randomUUID();
  const prefix="S74"+org.slice(0,8);
  const cleanup:Array<{table:string,id:string}>=[];
  const write=async(table:string,id:string,sql:string,args:Array<string|number|null>)=>{
    await writer.execute(sql,args);
    cleanup.unshift({table,id});
  };
  const reports:Record<string,string>={};
  const decode=(v:unknown)=>typeof v==="string"?JSON.parse(v):v;
  async function issue(code:string,tenant:string,patientId:string,branchId:string,userId:string,
    ordered:string,issued:string,frozenPatient:string,frozenOrder:string | null,value:string){
    const orderId=randomUUID(),reportId=randomUUID(),vId=randomUUID(),rId=randomUUID(),itemId=randomUUID();
    const accession=prefix+"ACC"+code;
    await write("orders",orderId,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,ordered_at,updated_at) VALUES(?,?,?,?,?,?,?,NOW(3))",
      [orderId,tenant,accession,branchId,patientId,userId,ordered]);
    await write("diagnostic_reports",reportId,
      "INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) VALUES(?,?,?,1,NOW(3))",
      [reportId,tenant,orderId]);
    const snapshot={order:{id:frozenOrder || orderId,accessionNumber:accession},
      patient:{id:frozenPatient},results:[{
        resultId:rId,orderItemId:itemId,resultVersion:1,
        testId:"test-glucose",testCode:"GLU",testNameEn:"Glucose",methodId:"method-1",
        analyzer:{code:"ANA-1"},performingBranch:{id:branchId},
        values:[{componentId:"component-glucose",componentCode:"GLU",componentNameEn:"Glucose",
          displayValue:value,unit:"mg/dL",flag:"NORMAL",referenceLow:"70",referenceHigh:"100",
          referenceTextEn:"70-100"}]}]};
    const pointers=[{orderItemId:itemId,resultId:rId,resultVersion:1}];
    await write("diagnostic_report_versions",vId,
      "INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id,issued_at) VALUES(?,?,1,'FINAL',?,?,?,?,?,?)",
      [vId,reportId,branchId,JSON.stringify(snapshot),JSON.stringify(pointers),randomUUID(),userId,issued]);
    reports[code]=reportId;
    return orderId;
  }
  async function evidence(code:string,tenant:string):Promise<ReportComparisonEvidence | null>{
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT o.id,o.patient_id,o.accession_number,o.ordered_at,d.current_version,v.version,v.status,v.issued_at,v.content_snapshot,v.result_version_snapshot "+
      "FROM diagnostic_reports d JOIN orders o ON o.id=d.order_id JOIN diagnostic_report_versions v ON v.report_id=d.id AND v.version=d.current_version "+
      "WHERE d.id=? AND d.organization_id=? AND o.organization_id=?",
      [reports[code],tenant,tenant]);
    if(!rows.length)return null;
    const r=rows[0];
    return {order:{id:String(r.id),patientId:String(r.patient_id),accessionNumber:String(r.accession_number),
      orderedAt:new Date(r.ordered_at)},currentVersion:Number(r.current_version),
      versions:[{version:Number(r.version),status:String(r.status),issuedAt:new Date(r.issued_at),
        contentSnapshot:decode(r.content_snapshot),resultVersionSnapshot:decode(r.result_version_snapshot)}]};
  }
  try{
    for(const [id,code] of [[org,"A"],[outside,"X"]]){
      await write("organizations",id,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+code,"Stage74 Tenant"]);
    }
    for(const [id,tenant,code] of [[branch,org,"B"],[otherBranch,org,"R"],[foreignBranch,outside,"F"]]){
      await write("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage74 Branch"]);
    }
    for(const [id,tenant,code] of [[staff,org,"U"],[foreignStaff,outside,"X"]]){
      await write("users",id,
        "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage74 Staff"]);
    }
    for(const [id,tenant,code] of [[patient,org,"P"],[anotherPatient,org,"Q"],[foreignPatient,outside,"F"]]){
      await write("patients",id,
        "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,tenant,prefix+code,"Stage74 Patient","stage74 patient"]);
    }
    await issue("NOW",org,patient,branch,staff,"2026-10-09 09:00:00","2026-10-09 12:00:00",patient,null,"97");
    await issue("OLD",org,patient,branch,staff,"2026-06-09 09:00:00","2026-06-09 12:00:00",patient,null,"88");
    await issue("BADPAT",org,patient,branch,staff,"2026-09-09 09:00:00","2026-09-09 12:00:00",anotherPatient,null,"500");
    await issue("BADORDER",org,patient,branch,staff,"2026-08-09 09:00:00","2026-08-09 12:00:00",patient,"another-order","600");
    await issue("RESTRICT",org,patient,otherBranch,staff,"2026-09-20 09:00:00","2026-09-20 12:00:00",patient,null,"700");
    await issue("FOREIGN",outside,foreignPatient,foreignBranch,foreignStaff,
      "2026-09-21 09:00:00","2026-09-21 12:00:00",foreignPatient,null,"900");

    const current=(await evidence("NOW",org))!;
    const old=(await evidence("OLD",org))!;
    const badPatient=(await evidence("BADPAT",org))!;
    const badOrder=(await evidence("BADORDER",org))!;
    const restricted=(await evidence("RESTRICT",org))!;
    assert.deepEqual(extractCurrentReportReadings(badPatient,[branch]),[]);
    assert.deepEqual(extractCurrentReportReadings(badOrder,[branch]),[]);
    assert.deepEqual(extractCurrentReportReadings(restricted,[branch]),[]);
    const comparisons=compareCurrentReportWithPrevious(current,[old,badPatient,badOrder,restricted],[branch]);
    assert.equal(comparisons.length,1);
    assert.equal(comparisons[0].previous?.value,"88");
    assert.equal(comparisons[0].previous?.referenceTextEn,"70-100");
    assert.equal(comparisons[0].reason,"MATCH");
    assert.equal(await evidence("FOREIGN",org),null);
    assert.deepEqual(extractCurrentReportReadings((await evidence("FOREIGN",outside))!,[branch]),[]);
    assert.equal((await evidence("OLD",org))!.versions[0].status,"FINAL");
  }finally{
    for(const item of cleanup)
      await writer.execute("DELETE FROM "+item.table+" WHERE id=?",[item.id]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
