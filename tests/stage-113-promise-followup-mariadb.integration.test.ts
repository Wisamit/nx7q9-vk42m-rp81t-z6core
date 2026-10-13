import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {buildDeliveryFollowupQueries,parseDeliveryFollowupFilters}
  from "../src/lib/report-delivery-followup.ts";

test("Stage 113 MariaDB: real current-report version, urgency, cancellation and cross-branch isolation",{timeout:90000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const cfg={host:uri.hostname,port:Number(uri.port||3306),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
    database:uri.pathname.slice(1)};
  const db=await mysql.createConnection(cfg);
  const org=randomUUID(),foreignOrg=randomUUID(),a=randomUUID(),b=randomUUID(),
    f=randomUUID(),user=randomUUID(),foreignUser=randomUUID(),patient=randomUUID(),
    foreignPatient=randomUUID(),suffix=org.slice(0,8);
  const cleanup:Array<{sql:string;id:string}>=[];
  async function add(sql:string,params:(string|number)[],table:string,id:string){
    await db.execute(sql,params);
    cleanup.unshift({sql:"DELETE FROM "+table+" WHERE id=?",id});
  }
  const now=new Date("2026-10-13T12:00:00.000Z");
  const ids:Record<string,string>={};
  try{
    for(const [id,c]of [[org,"O"],[foreignOrg,"F"]])
      await add("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S113"+suffix+c,"Followup Lab"],"organizations",id);
    for(const [id,tenant,c]of [[a,org,"A"],[b,org,"B"],[f,foreignOrg,"F"]])
      await add("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,"S113"+suffix+c,"Followup Branch"],"branches",id);
    for(const [id,tenant,c]of [[user,org,"A"],[foreignUser,foreignOrg,"F"]])
      await add("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,"s113"+suffix+c,"Followup User"],"users",id);
    for(const [id,tenant,c]of [[patient,org,"A"],[foreignPatient,foreignOrg,"F"]])
      await add("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,tenant,"S113"+suffix+c,"Followup Patient","followup patient"],"patients",id);
    const orders=[
      {key:"overdue",branch:a,tenant:org,actor:user,patient,status:"REGISTERED",at:"2026-10-13 08:00:00.000"},
      {key:"soonPartial",branch:a,tenant:org,actor:user,patient,status:"IN_PROGRESS",at:"2026-10-13 16:00:00.000"},
      {key:"laterRetracted",branch:a,tenant:org,actor:user,patient,status:"COMPLETED",at:"2026-10-15 12:00:00.000"},
      {key:"oldFinalRetracted",branch:a,tenant:org,actor:user,patient,status:"COMPLETED",at:"2026-10-13 08:00:00.000"},
      {key:"issuedFinal",branch:a,tenant:org,actor:user,patient,status:"COMPLETED",at:"2026-10-13 08:00:00.000"},
      {key:"issuedAmended",branch:a,tenant:org,actor:user,patient,status:"COMPLETED",at:"2026-10-13 16:00:00.000"},
      {key:"cancelled",branch:a,tenant:org,actor:user,patient,status:"CANCELLED",at:"2026-10-13 08:00:00.000"},
      {key:"branchB",branch:b,tenant:org,actor:user,patient,status:"REGISTERED",at:"2026-10-13 16:00:00.000"},
      {key:"foreign",branch:f,tenant:foreignOrg,actor:foreignUser,patient:foreignPatient,status:"REGISTERED",at:"2026-10-13 08:00:00.000"},
    ];
    for(const [i,row]of orders.entries()){
      const id=randomUUID();ids[row.key]=id;
      const localTime=row.at.replace(" ","T").slice(0,16);
      await add("INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,status,promised_report_delivery_at_utc,promised_report_delivery_local,promised_report_delivery_timezone,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,NOW(3))",
        [id,row.tenant,"S113-"+suffix+"-"+i,row.branch,row.patient,row.actor,row.status,
          row.at,localTime,"Etc/UTC"],"orders",id);
    }
    async function report(key:string,statuses:string[]){
      const reportId=randomUUID(),record=orders.find(z=>z.key===key)!;
      await add("INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) VALUES(?,?,?,?,NOW(3))",
        [reportId,record.tenant,ids[key],statuses.length],"diagnostic_reports",reportId);
      for(let i=0;i<statuses.length;i++){
        const versionId=randomUUID();
        await add("INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id,issued_at) VALUES(?,?,?,?,?,'{}','[]',?,?,NOW(3))",
          [versionId,reportId,i+1,statuses[i],record.branch,
            "s113"+randomUUID().replaceAll("-",""),record.actor],
          "diagnostic_report_versions",versionId);
      }
    }
    await report("soonPartial",["PARTIAL"]);
    await report("laterRetracted",["RETRACTED"]);
    await report("oldFinalRetracted",["FINAL","RETRACTED"]);
    await report("issuedFinal",["FINAL"]);
    await report("issuedAmended",["FINAL","AMENDED"]);

    const run=async(status:string,branches:string[]=[a,b],branchId="")=>{
      const parsed=parseDeliveryFollowupFilters({status,branchId},branches);
      assert.equal(parsed.ok,true);
      if(!parsed.ok)throw Error("filter invalid");
      const q=buildDeliveryFollowupQueries({
        organizationId:org,branchIds:branches,filters:parsed.value,nowUtc:now,
      });
      const [counts]=await db.execute<mysql.RowDataPacket[]>(q.count.sql,q.count.params);
      const [items]=await db.execute<mysql.RowDataPacket[]>(q.ids.sql,q.ids.params);
      return {count:Number(counts[0].total),ids:items.map(v=>v.orderId as string),
        rows:items};
    };
    const overdue=await run("OVERDUE");
    assert.equal(overdue.count,2);
    assert.deepEqual(new Set(overdue.ids),new Set([ids.overdue,ids.oldFinalRetracted]));
    const retractedRow=overdue.rows.find(x=>x.orderId===ids.oldFinalRetracted);
    assert.ok(retractedRow,"withdrawn current version should remain overdue");
    assert.equal(retractedRow.currentReportStatus,"RETRACTED");
    const soon=await run("DUE_SOON");
    assert.equal(soon.count,2);
    assert.deepEqual(new Set(soon.ids),new Set([ids.soonPartial,ids.branchB]));
    const later=await run("FUTURE");
    assert.deepEqual(later.ids,[ids.laterRetracted]);
    const issued=await run("CURRENT_ISSUED");
    assert.equal(issued.count,2);
    assert.deepEqual(new Set(issued.ids),new Set([ids.issuedFinal,ids.issuedAmended]));
    const pending=await run("PENDING");
    assert.equal(pending.count,5);
    assert.deepEqual(new Set(pending.ids),new Set([ids.overdue,ids.soonPartial,
      ids.laterRetracted,ids.oldFinalRetracted,ids.branchB]));
    const all=await run("ALL");
    assert.equal(all.count,7,"cancelled and foreign-tenant orders excluded");
    assert.equal(all.ids.includes(ids.cancelled),false);
    assert.equal(all.ids.includes(ids.foreign),false);
    assert.deepEqual((await run("DUE_SOON",[a],a)).ids,[ids.soonPartial]);
    assert.equal((await run("CURRENT_ISSUED",[b],b)).count,0);
    assert.equal((await run("PENDING",[b],b)).count,1);
    assert.equal(parseDeliveryFollowupFilters({branchId:f},[a,b]).ok,false);
  }finally{
    for(const item of cleanup)await db.execute(item.sql,[item.id]).catch(()=>{});
    await db.end();
  }
});
