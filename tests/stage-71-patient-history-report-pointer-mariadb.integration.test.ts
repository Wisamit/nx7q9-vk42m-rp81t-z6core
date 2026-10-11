import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  currentReportResultPointers, resultMatchesCurrentReportPointer,
  latestClinicalResultIds,
} from "../src/lib/patient-history.ts";

test("Stage 71 MariaDB: immutable report snapshots cannot disclose stale or wrong-order result revisions",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const config={host:uri.hostname,port:Number(uri.port||3306),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
    database:uri.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),outside=randomUUID(),branch=randomUUID(),actor=randomUUID();
  const patient=randomUUID(),testId=randomUUID(),orders=[randomUUID(),randomUUID()];
  const items=[randomUUID(),randomUUID()],reports=[randomUUID(),randomUUID()];
  const resultIds=[randomUUID(),randomUUID(),randomUUID()];
  const reportVersions=[randomUUID(),randomUUID(),randomUUID()];
  const prefix="S71"+org.slice(0,8);
  const created:Array<{table:string,id:string}>=[];
  const write=async(table:string,id:string,sql:string,values:Array<string|number|null>)=>{
    await writer.execute(sql,values);
    created.unshift({table,id});
  };
  const pointer=(id:string,item:string,version:number)=>({
    resultId:id,orderItemId:item,resultVersion:version,
  });
  const parse=(v:unknown)=>typeof v==="string"?JSON.parse(v):v;
  try{
    for(const [id,suffix] of [[org,"A"],[outside,"X"]]){
      await write("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+suffix,"Stage71 Organization"]);
    }
    await write("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,prefix+"B","Stage71 Branch"]);
    await write("users",actor,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor,org,prefix+"U","Stage71 User"]);
    await write("patients",patient,
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [patient,org,prefix+"P","Stage71 Patient","stage71 patient"]);
    await write("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,prefix+"O"===prefix+"X"?outside:org,prefix+"T","Stage71 Test"]);
    for(let i=0;i<2;i++){
      await write("orders",orders[i],
        "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
        [orders[i],org,prefix+"ACC"+i,branch,patient,actor]);
      await write("order_items",items[i],
        "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
        [items[i],orders[i],testId,prefix+"T","Stage71 Test"]);
      await write("diagnostic_reports",reports[i],
        "INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) VALUES(?,?,?,?,NOW(3))",
        [reports[i],org,orders[i],i===0?2:1]);
    }
    for(const [index,itemId,version,status] of [
      [0,items[0],1,"RELEASED"],[1,items[0],2,"AMENDED"],
      [2,items[1],1,"RELEASED"],
    ] as const){
      await write("laboratory_results",resultIds[index],
        "INSERT INTO laboratory_results(id,organization_id,order_item_id,performing_branch_id,version,status,entered_by_user_id,updated_at) VALUES(?,?,?,?,?,?,?,NOW(3))",
        [resultIds[index],org,itemId,version,status,actor]);
    }
    const reportEntries=[
      {version:1,report:reports[0],status:"FINAL",
        snapshot:[pointer(resultIds[0],items[0],1)]},
      {version:2,report:reports[0],status:"AMENDED",
        snapshot:[
          pointer(resultIds[1],items[0],2),
          // Wrong report order, but otherwise correct item/version.
          pointer(resultIds[2],items[1],1),
        ]},
      {version:1,report:reports[1],status:"FINAL",
        snapshot:[pointer(resultIds[2],items[1],1)]},
    ];
    for(let i=0;i<reportEntries.length;i++){
      const entry=reportEntries[i];
      await write("diagnostic_report_versions",reportVersions[i],
        "INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id) VALUES(?,?,?,?,?,?,?,?,?)",
        [reportVersions[i],entry.report,entry.version,entry.status,branch,
          JSON.stringify({}),JSON.stringify(entry.snapshot),prefix+"V"+i,actor]);
    }
    const [evidence]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT r.order_id,r.current_version,v.version,v.status,v.result_version_snapshot "+
      "FROM diagnostic_reports r JOIN diagnostic_report_versions v ON v.report_id=r.id "+
      "AND v.version=r.current_version WHERE r.organization_id=? AND r.order_id IN (?,?)",
      [org,...orders]);
    assert.equal(evidence.length,2);
    const pointers=currentReportResultPointers(evidence.map(x=>({
      orderId:String(x.order_id),currentVersion:Number(x.current_version),
      versions:[{version:Number(x.version),status:String(x.status),
        resultVersionSnapshot:parse(x.result_version_snapshot)}],
    })));
    assert.deepEqual([...pointers.keys()],[resultIds[1]]);
    const [stored]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT r.id,r.order_item_id,r.version,r.status,i.order_id FROM laboratory_results r "+
      "JOIN order_items i ON i.id=r.order_item_id "+
      "JOIN orders o ON o.id=i.order_id "+
      "WHERE r.organization_id=? AND o.patient_id=? AND r.performing_branch_id=?",
      [org,patient,branch]);
    assert.equal(stored.length,3);
    const allowed=stored.filter(x=>resultMatchesCurrentReportPointer({
      id:String(x.id),orderItemId:String(x.order_item_id),
      version:Number(x.version),orderItem:{order:{id:String(x.order_id)}},
    },pointers));
    assert.deepEqual(allowed.map(x=>x.id),[resultIds[1]]);
    assert.deepEqual([...latestClinicalResultIds(allowed.map(x=>({
      orderItemId:String(x.order_item_id),version:Number(x.version),
      status:String(x.status),releasedAt:new Date(),
    })))],[items[0]+":2"]);
    const [outsideRows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM diagnostic_reports WHERE organization_id=?",[outside]);
    assert.equal(Number(outsideRows[0].n),0);
  }finally{
    for(const item of created){
      await writer.execute("DELETE FROM "+item.table+" WHERE id=?",[item.id]).catch(()=>{});
    }
    await Promise.all([writer.end(),reader.end()]);
  }
});
