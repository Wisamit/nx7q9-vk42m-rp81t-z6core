import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {parsePromisedReportDelivery} from "../src/lib/order-promised-delivery.ts";

test("Stage 112 MariaDB: optional delivery promises preserve order-local history despite branch timezone edits",{timeout:45000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const db=await mysql.createConnection(cfg);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),
    actor=randomUUID(),patient=randomUUID(),order=randomUUID(),none=randomUUID();
  const suffix=org.slice(0,8);
  const cleanup:Array<{sql:string;params:string[]}>=[];

  async function add(sql:string,params:string[],table:string,id:string){
    await db.execute(sql,params);
    cleanup.unshift({sql:"DELETE FROM "+table+" WHERE id=?",params:[id]});
  }
  try{
    for(const [id,code] of [[org,"A"],[foreignOrg,"F"]])
      await add("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,"S112-"+suffix+code,"Synthetic Lab"],"organizations",id);
    for(const [id,parent,code,zone] of [
      [branch,org,"A","Asia/Dubai"],[otherBranch,foreignOrg,"F","Europe/Istanbul"],
    ])
      await add("INSERT INTO branches(id,organization_id,code,name_en,timezone,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [id,parent,"S112-"+suffix+code,"Synthetic Branch",zone],"branches",id);
    await add("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [actor,org,"s112-"+suffix,"Synthetic User"],"users",actor);
    await add("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [patient,org,"S112-"+suffix,"Synthetic Patient","synthetic patient"],"patients",patient);

    const result=parsePromisedReportDelivery("2026-10-14T10:15","Asia/Dubai",
      new Date("2026-10-13T00:00:00.000Z"));
    assert.equal(result.ok,true);
    if(!result.ok||!result.snapshot)throw Error("valid promise missing");
    const promise=result.snapshot;
    await add("INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,promised_report_delivery_at_utc,promised_report_delivery_local,promised_report_delivery_timezone,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NOW(3))",
      [order,org,"S112-ORDER-"+suffix,branch,patient,actor,
        promise.promisedReportDeliveryAtUtc.toISOString().slice(0,23).replace("T"," "),
        promise.promisedReportDeliveryLocal,promise.promisedReportDeliveryTimezone],"orders",order);
    await add("INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
      [none,org,"S112-NONE-"+suffix,branch,patient,actor],"orders",none);
    const query="SELECT promised_report_delivery_at_utc AS utcValue,promised_report_delivery_local AS localValue,promised_report_delivery_timezone AS zone FROM orders WHERE id=?";
    const [before]=await db.execute<mysql.RowDataPacket[]>(query,[order]);
    assert.equal(before[0].utcValue.toISOString(),"2026-10-14T06:15:00.000Z");
    assert.equal(before[0].localValue,"2026-10-14T10:15");
    assert.equal(before[0].zone,"Asia/Dubai");
    const [old]=await db.execute<mysql.RowDataPacket[]>(query,[none]);
    assert.equal(old[0].utcValue,null);
    assert.equal(old[0].localValue,null);
    assert.equal(old[0].zone,null);
    await db.execute("UPDATE branches SET timezone='Europe/Istanbul' WHERE id=?",[branch]);
    const [historical]=await db.execute<mysql.RowDataPacket[]>(query,[order]);
    assert.equal(historical[0].utcValue.toISOString(),"2026-10-14T06:15:00.000Z");
    assert.equal(historical[0].localValue,"2026-10-14T10:15");
    assert.equal(historical[0].zone,"Asia/Dubai");
    const [foreign]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM orders WHERE id=? AND organization_id=? AND ordering_branch_id=?",
      [order,foreignOrg,otherBranch]);
    assert.equal(foreign.length,0);
  } finally {
    for(const row of cleanup)await db.execute(row.sql,row.params).catch(()=>{});
    await db.end();
  }
});
