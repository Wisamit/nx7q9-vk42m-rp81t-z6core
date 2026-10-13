import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {
  buildReportQueueQueries,parseReportQueueFilters,
} from "../src/lib/report-print-queue.ts";

test("Stage 111 real MariaDB: current-version print evidence excludes old versions, retractions and unauthorized branches",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const cfg={host:uri.hostname,port:Number(uri.port||3306),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
    database:uri.pathname.slice(1)};
  const db=await mysql.createConnection(cfg);
  const org=randomUUID(),foreignOrg=randomUUID();
  const branchA=randomUUID(),branchB=randomUUID(),foreignBranch=randomUUID();
  const userA=randomUUID(),foreignUser=randomUUID();
  const patientA=randomUUID(),foreignPatient=randomUUID();
  const suffix=org.slice(0,8);
  const cleanup:Array<{sql:string;params:string[]}>=[];

  async function add(sql:string,args:string[],table:string,id:string){
    await db.execute(sql,args);
    cleanup.unshift({sql:"DELETE FROM "+table+" WHERE id=?",params:[id]});
  }
  const reportA=randomUUID(),reportB=randomUUID(),reportRetracted=randomUUID(),reportOther=randomUUID();
  const versionA1=randomUUID(),versionA2=randomUUID(),versionB=randomUUID(),
    versionRetracted=randomUUID(),versionOther=randomUUID();
  try {
    for(const [id,code] of [[org,"A"],[foreignOrg,"F"]]){
      await add("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,"S111-"+suffix+code,"Stage 111 Lab"],"organizations",id);
    }
    for(const [id,parent,code]of [[branchA,org,"A"],[branchB,org,"B"],[foreignBranch,foreignOrg,"F"]]){
      await add("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,parent,"S111-"+suffix+code,"Stage 111 Branch"],"branches",id);
    }
    for(const [id,parent,code]of [[userA,org,"A"],[foreignUser,foreignOrg,"F"]]){
      await add("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,parent,"s111-"+suffix+code,"Synthetic Issuer"],"users",id);
    }
    for(const [id,parent,code]of [[patientA,org,"A"],[foreignPatient,foreignOrg,"F"]]){
      await add("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [id,parent,"S111-"+suffix+code,"Synthetic Patient","synthetic patient"],"patients",id);
    }
    const orders=[
      {id:randomUUID(),branch:branchA,patient:patientA,user:userA,org,report:reportA,code:"A"},
      {id:randomUUID(),branch:branchB,patient:patientA,user:userA,org,report:reportB,code:"B"},
      {id:randomUUID(),branch:branchA,patient:patientA,user:userA,org,report:reportRetracted,code:"R"},
      {id:randomUUID(),branch:foreignBranch,patient:foreignPatient,user:foreignUser,org:foreignOrg,report:reportOther,code:"F"},
    ];
    for(const o of orders){
      await add("INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
        [o.id,o.org,"S111-ACC-"+suffix+o.code,o.branch,o.patient,o.user],"orders",o.id);
      await add("INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) VALUES (?,?,?,1,NOW(3))",
        [o.report,o.org,o.id],"diagnostic_reports",o.report);
    }
    const versionRows=[
      {id:versionA1,report:reportA,v:"1",status:"FINAL",branch:branchA,user:userA,at:"2026-10-12 09:00:00.000"},
      {id:versionA2,report:reportA,v:"2",status:"AMENDED",branch:branchA,user:userA,at:"2026-10-12 14:00:00.000"},
      {id:versionB,report:reportB,v:"1",status:"FINAL",branch:branchB,user:userA,at:"2026-10-12 15:00:00.000"},
      {id:versionRetracted,report:reportRetracted,v:"1",status:"RETRACTED",branch:branchA,user:userA,at:"2026-10-12 16:00:00.000"},
      {id:versionOther,report:reportOther,v:"1",status:"FINAL",branch:foreignBranch,user:foreignUser,at:"2026-10-12 17:00:00.000"},
    ];
    for(const v of versionRows){
      await add("INSERT INTO diagnostic_report_versions (id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id,issued_at) VALUES (?,?,?,?,?,'{}','[]',?,?,?)",
        [v.id,v.report,v.v,v.status,v.branch,"s111"+randomUUID().replaceAll("-",""),v.user,v.at],
        "diagnostic_report_versions",v.id);
    }
    await db.execute("UPDATE diagnostic_reports SET current_version=2 WHERE id=?",[reportA]);
    for(const [version,actor]of [[versionA1,userA],[versionB,userA],[versionOther,foreignUser]]){
      const id=randomUUID();
      await add("INSERT INTO report_delivery_events(id,report_version_id,channel,status,performed_by_user_id,occurred_at) VALUES (?,?,'PRINT','RECORDED',?,NOW(3))",
        [id,version,actor],"report_delivery_events",id);
    }
    const run=async(input:Record<string,string>,scope:string[]=[branchA,branchB])=>{
      const parsed=parseReportQueueFilters(input,scope);
      assert.equal(parsed.ok,true);
      if(!parsed.ok)throw Error(parsed.error);
      const q=buildReportQueueQueries({organizationId:org,authorizedBranchIds:scope,filters:parsed.value});
      const [count]=await db.execute<mysql.RowDataPacket[]>(q.count.sql,q.count.params);
      const [rows]=await db.execute<mysql.RowDataPacket[]>(q.ids.sql,q.ids.params);
      return {count:Number(count[0].total),ids:rows.map(row=>row.reportId as string)};
    };
    assert.deepEqual(await run({print:"NO_RECORD",branchId:branchA}),
      {count:1,ids:[reportA]},"old version printed, latest amended version not printed; retracted ignored");
    assert.deepEqual(await run({print:"RECORDED"}),{count:1,ids:[reportB]},
      "historical print and foreign tenant are excluded");
    assert.deepEqual(await run({print:"RECORDED",branchId:branchB,status:"FINAL"}),
      {count:1,ids:[reportB]});
    assert.deepEqual(await run({print:"RECORDED",branchId:branchA}),{count:0,ids:[]});
    assert.deepEqual(await run({print:"RECORDED"},[branchA]),{count:0,ids:[]},
      "narrowing staff scope must never widen branch visibility");
    assert.deepEqual(await run({status:"RETRACTED",branchId:branchA}),
      {count:1,ids:[reportRetracted]},"explicit retracted review remains possible");
    assert.deepEqual(await run({status:"RETRACTED",print:"NO_RECORD",branchId:branchA}),
      {count:0,ids:[]});
    assert.deepEqual(await run({print:"NO_RECORD",status:"AMENDED",from:"2026-10-12",to:"2026-10-12"}),
      {count:1,ids:[reportA]});
    assert.deepEqual(await run({print:"NO_RECORD",from:"2026-10-13",to:"2026-10-13"}),
      {count:0,ids:[]});
    assert.deepEqual(await run({accession:"' OR 1=1 --"}),
      {count:0,ids:[]}, "accession is a SQL value, never SQL syntax");
    assert.deepEqual(await run({accession:"S111-ACC-"+suffix+"B"}),
      {count:1,ids:[reportB]});
  } finally {
    for(const line of cleanup){
      await db.execute(line.sql,line.params).catch(()=>{});
    }
    await db.end();
  }
});
