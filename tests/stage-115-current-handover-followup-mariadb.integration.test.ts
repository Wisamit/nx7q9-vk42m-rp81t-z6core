import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {buildDeliveryFollowupQueries,parseDeliveryFollowupFilters} from "../src/lib/report-delivery-followup.ts";

test("Stage 115 real MariaDB: only latest report version with audited staff attestation qualifies",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const config={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const db=await mysql.createConnection(config);
  const org=randomUUID(),foreignOrg=randomUUID();
  const a=randomUUID(),b=randomUUID(),foreignBranch=randomUUID();
  const actor=randomUUID(),foreignActor=randomUUID();
  const patient=randomUUID(),foreignPatient=randomUUID();
  const suffix=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  const ids:Record<string,string>={},versions:Record<string,string[]>={};
  const nowUtc=new Date("2026-10-13T12:00:00.000Z");
  async function add(table:string,sql:string,args:(string|number)[],id:string){
    await db.execute(sql,args);
    cleanup.unshift({table,id});
  }
  try{
    for(const [id,code]of [[org,"A"],[foreignOrg,"F"]]){
      await add("organizations",
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S115"+suffix+code,"Synthetic Lab"],id);
    }
    for(const [id,tenant,code]of [
      [a,org,"A"],[b,org,"B"],[foreignBranch,foreignOrg,"F"],
    ]){
      await add("branches",
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,"S115"+suffix+code,"Synthetic Branch"],id);
    }
    for(const [id,tenant,code]of [[actor,org,"A"],[foreignActor,foreignOrg,"F"]]){
      await add("users",
        "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,"s115"+suffix+code,"Synthetic User"],id);
    }
    for(const [id,tenant,code]of [[patient,org,"A"],[foreignPatient,foreignOrg,"F"]]){
      await add("patients",
        "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,tenant,"S115"+suffix+code,"Synthetic Patient","synthetic patient"],id);
    }
    const rows=[
      {key:"finalWithStaff",tenant:org,branch:a,actor,patient,status:"COMPLETED",versions:["FINAL"],promise:true},
      {key:"finalWithout",tenant:org,branch:a,actor,patient,status:"COMPLETED",versions:["FINAL"],promise:true},
      {key:"amendedOldOnly",tenant:org,branch:a,actor,patient,status:"COMPLETED",versions:["FINAL","AMENDED"],promise:true},
      {key:"amendedCurrent",tenant:org,branch:a,actor,patient,status:"COMPLETED",versions:["FINAL","AMENDED"],promise:true},
      {key:"oldFinalRetracted",tenant:org,branch:a,actor,patient,status:"COMPLETED",versions:["FINAL","RETRACTED"],promise:true},
      {key:"printOnly",tenant:org,branch:a,actor,patient,status:"COMPLETED",versions:["FINAL"],promise:true},
      {key:"unkeyedOther",tenant:org,branch:a,actor,patient,status:"COMPLETED",versions:["FINAL"],promise:true},
      {key:"branchBStaff",tenant:org,branch:b,actor,patient,status:"COMPLETED",versions:["FINAL"],promise:true},
      {key:"cancelledStaff",tenant:org,branch:a,actor,patient,status:"CANCELLED",versions:["FINAL"],promise:true},
      {key:"noPromiseStaff",tenant:org,branch:a,actor,patient,status:"COMPLETED",versions:["FINAL"],promise:false},
      {key:"foreignStaff",tenant:foreignOrg,branch:foreignBranch,actor:foreignActor,patient:foreignPatient,status:"COMPLETED",versions:["FINAL"],promise:true},
    ];
    for(const [i,row] of rows.entries()){
      const orderId=randomUUID(),reportId=randomUUID();
      ids[row.key]=orderId;
      await add("orders",
        "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,status,promised_report_delivery_at_utc,promised_report_delivery_local,promised_report_delivery_timezone,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,NOW(3))",
        [orderId,row.tenant,"S115-"+suffix+"-"+i,row.branch,row.patient,row.actor,row.status,
          row.promise?"2026-10-13 14:00:00.000":null,
          row.promise?"2026-10-13T14:00":null,
          row.promise?"Etc/UTC":null],"orders",orderId);
      await add("diagnostic_reports",
        "INSERT INTO diagnostic_reports(id,organization_id,order_id,current_version,updated_at) VALUES(?,?,?,?,NOW(3))",
        [reportId,row.tenant,orderId,row.versions.length],"diagnostic_reports",reportId);
      versions[row.key]=[];
      for(const [v,status]of row.versions.entries()){
        const versionId=randomUUID();
        versions[row.key].push(versionId);
        await add("diagnostic_report_versions",
          "INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id,issued_at) VALUES(?,?,?,?,?,'{}','[]',?,?,NOW(3))",
          [versionId,reportId,v+1,status,row.branch,
            "s115"+randomUUID().replaceAll("-",""),row.actor],
          "diagnostic_report_versions",versionId);
      }
    }
    async function event(key:string,which:number,kind:"HANDOVER"|"PRINT"|"UNKEYED"){
      const row=rows.find(x=>x.key===key)!;
      const id=randomUUID();
      const evidence={evidenceType:"STAFF_ATTESTED_IN_PERSON_HANDOVER_V1",
        staffAttestedInPersonHandover:true,independentPatientAcknowledgement:false};
      const request=kind==="HANDOVER"?randomUUID():null;
      await add("report_delivery_events",
        "INSERT INTO report_delivery_events(id,report_version_id,channel,status,recipient,performed_by_user_id,handover_request_id,details,occurred_at) VALUES (?,?,?,'RECORDED',?,?,?, ?,NOW(3))",
        [id,versions[key][which],kind==="PRINT"?"PRINT":"OTHER",kind==="PRINT"?null:"PATIENT",
          row.actor,request,JSON.stringify(evidence)],"report_delivery_events",id);
    }
    await event("finalWithStaff",0,"HANDOVER");
    await event("amendedOldOnly",0,"HANDOVER");
    await event("amendedCurrent",1,"HANDOVER");
    await event("oldFinalRetracted",0,"HANDOVER");
    await event("printOnly",0,"PRINT");
    await event("unkeyedOther",0,"UNKEYED");
    await event("branchBStaff",0,"HANDOVER");
    await event("cancelledStaff",0,"HANDOVER");
    await event("noPromiseStaff",0,"HANDOVER");
    await event("foreignStaff",0,"HANDOVER");

    const select=async(status:string,branchIds:string[]=[a,b],branchId="")=>{
      const parsed=parseDeliveryFollowupFilters({status,branchId},branchIds);
      assert.equal(parsed.ok,true);
      if(!parsed.ok)throw Error("filter rejected");
      const q=buildDeliveryFollowupQueries({
        organizationId:org,branchIds,filters:parsed.value,nowUtc,
      });
      const [count]=await db.execute<mysql.RowDataPacket[]>(q.count.sql,q.count.params);
      const [items]=await db.execute<mysql.RowDataPacket[]>(q.ids.sql,q.ids.params);
      return {
        count:Number(count[0].total),
        ids:items.map(x=>x.orderId as string),
        evidence:new Map(items.map(x=>[x.orderId as string,Number(x.currentStaffAttested)])),
      };
    };
    const withAttestation=await select("CURRENT_ISSUED_WITH_STAFF_ATTESTATION");
    assert.equal(withAttestation.count,3);
    assert.deepEqual(new Set(withAttestation.ids),
      new Set([ids.finalWithStaff,ids.amendedCurrent,ids.branchBStaff]));
    assert.deepEqual(new Set(withAttestation.evidence.values()),new Set([1]));
    const noAttestation=await select("CURRENT_ISSUED_NO_STAFF_ATTESTATION");
    assert.equal(noAttestation.count,4);
    assert.deepEqual(new Set(noAttestation.ids),
      new Set([ids.finalWithout,ids.amendedOldOnly,ids.printOnly,ids.unkeyedOther]));
    assert.deepEqual(new Set(noAttestation.evidence.values()),new Set([0]));
    assert.equal(noAttestation.ids.includes(ids.oldFinalRetracted),false);
    assert.equal(noAttestation.ids.includes(ids.foreignStaff),false);
    assert.equal(noAttestation.ids.includes(ids.cancelledStaff),false);
    assert.equal(noAttestation.ids.includes(ids.noPromiseStaff),false);
    const issued=await select("CURRENT_ISSUED");
    assert.equal(issued.count,7);
    assert.deepEqual(new Set(issued.ids),
      new Set([...withAttestation.ids,...noAttestation.ids]));
    assert.deepEqual((await select("CURRENT_ISSUED_WITH_STAFF_ATTESTATION",[a],a)).ids.sort(),
      [ids.finalWithStaff,ids.amendedCurrent].sort());
    assert.deepEqual((await select("CURRENT_ISSUED_NO_STAFF_ATTESTATION",[b],b)).ids,[]);
    assert.equal(parseDeliveryFollowupFilters({branchId:foreignBranch},[a,b]).ok,false);
  }finally{
    for(const line of cleanup)await db.execute("DELETE FROM "+line.table+" WHERE id=?",
      [line.id]).catch(()=>{});
    await db.end();
  }
});
