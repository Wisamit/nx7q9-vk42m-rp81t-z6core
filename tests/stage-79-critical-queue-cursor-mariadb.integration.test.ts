import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  criticalQueuePage, encodeCriticalQueueCursor, decodeCriticalQueueCursor,
  type CriticalQueueFilter, type CriticalQueuePosition,
} from "../src/lib/critical-results-queue.ts";

/**
 * Uses real MariaDB tables for >300 critical reports. Pagination deliberately
 * follows the same NULLS LAST ordering and keyset predicates as the clinical
 * Prisma route, including scoping at every page, not just the first page.
 */
test("Stage 79 MariaDB: 330 authorized critical events remain reachable; due-first cursor never leaks other branches or tenants", {
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const cfg={host:uri.hostname,port:Number(uri.port||3306),user:decodeURIComponent(uri.username),
    password:decodeURIComponent(uri.password),database:uri.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),restrictedBranch=randomUUID(),
    foreignBranch=randomUUID(),actor=randomUUID(),foreignActor=randomUUID(),patient=randomUUID(),
    foreignPatient=randomUUID(),testId=randomUUID(),foreignTest=randomUUID(),
    orderId=randomUUID(),foreignOrder=randomUUID(),itemId=randomUUID(),foreignItem=randomUUID();
  const label="S79"+org.slice(0,8);
  const now=new Date("2026-10-11T12:00:00.000Z");
  type Fixture={resultId:string,eventId:string,due:Date|null,detected:Date,branchId:string,tenant:string,status:"OPEN"|"ACKNOWLEDGED"};
  const fixtures:Fixture[]=[];
  const cleanup:Array<{table:string,id:string}>=[];
  async function put(table:string,id:string,sql:string,args:(string|number|null)[]){
    await writer.execute(sql,args);cleanup.unshift({table,id});
  }
  const date=(d:Date|null)=>d?.toISOString().replace("T"," ").replace("Z","")??null;
  async function batch(sqlPrefix:string,values:(string|number|null)[][]){
    for(let i=0;i<values.length;i+=65){
      const items=values.slice(i,i+65);
      const qs=items.map(row=>"("+row.map(()=>"?").join(",")+")").join(",");
      await writer.execute(sqlPrefix+qs,items.flat());
    }
  }
  async function loadPage(filter:CriticalQueueFilter,cursor:CriticalQueuePosition|null){
    const conditions=["e.status='OPEN'","r.organization_id=?","r.performing_branch_id=?"];
    const args:(string|number|null)[]=[org,branch];
    if(filter==="overdue"){conditions.push("e.acknowledgement_due_at<=?");args.push(date(now));}
    if(cursor){
      const detected=date(cursor.detectedAt);
      if(cursor.acknowledgementDueAt===null){
        conditions.push("(e.acknowledgement_due_at IS NULL AND "+
          "(e.detected_at>? OR (e.detected_at=? AND e.id>?)))");
        args.push(detected!,detected!,cursor.id);
      }else{
        const due=date(cursor.acknowledgementDueAt);
        conditions.push("(e.acknowledgement_due_at>? OR "+
          "(e.acknowledgement_due_at=? AND e.detected_at>?) OR "+
          "(e.acknowledgement_due_at=? AND e.detected_at=? AND e.id>?) OR "+
          "e.acknowledgement_due_at IS NULL)");
        args.push(due!,due!,detected!,due!,detected!,cursor.id);
      }
    }
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT e.id,e.acknowledgement_due_at,e.detected_at "+
      "FROM critical_result_events e JOIN laboratory_results r ON r.id=e.result_id "+
      "WHERE "+conditions.join(" AND ")+" "+
      "ORDER BY e.acknowledgement_due_at IS NULL ASC,"+
      "e.acknowledgement_due_at ASC,e.detected_at ASC,e.id ASC LIMIT 51",args);
    return rows.map(row=>({
      id:String(row.id),detectedAt:new Date(row.detected_at),
      acknowledgementDueAt:row.acknowledgement_due_at===null?null:new Date(row.acknowledgement_due_at),
    }));
  }
  async function count(filter:CriticalQueueFilter){
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM critical_result_events e JOIN laboratory_results r "+
      "ON r.id=e.result_id WHERE e.status='OPEN' AND r.organization_id=? "+
      "AND r.performing_branch_id=?"+
      (filter==="overdue"?" AND e.acknowledgement_due_at<=?":""),
      filter==="overdue"?[org,branch,date(now)]:[org,branch]);
    return Number(rows[0].total);
  }
  try{
    for(const [id,code] of [[org,"A"],[foreignOrg,"F"]])
      await put("organizations",id,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,label+code,"Stage79 Organization"]);
    for(const [id,tenant,code] of [
      [branch,org,"A"],[restrictedBranch,org,"B"],[foreignBranch,foreignOrg,"F"],
    ])await put("branches",id,"INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [id,tenant,label+code,"Stage79 Branch"]);
    for(const [id,tenant,code] of [[actor,org,"A"],[foreignActor,foreignOrg,"F"]])
      await put("users",id,"INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,label+code,"Stage79 Reviewer"]);
    for(const [id,tenant,code] of [[patient,org,"A"],[foreignPatient,foreignOrg,"F"]])
      await put("patients",id,"INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,tenant,label+code,"Stage79 Patient","stage79 patient"]);
    for(const [id,tenant,code] of [[testId,org,"A"],[foreignTest,foreignOrg,"F"]])
      await put("lab_tests",id,"INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,label+code,"Stage79 Test"]);
    for(const [id,tenant,code,br,person,personUser] of [
      [orderId,org,"A",branch,patient,actor],
      [foreignOrder,foreignOrg,"F",foreignBranch,foreignPatient,foreignActor],
    ])await put("orders",id,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) "+
      "VALUES(?,?,?,?,?,?,NOW(3))",[id,tenant,label+code,br,person,personUser]);
    for(const [id,ord,test,code] of [[itemId,orderId,testId,"A"],[foreignItem,foreignOrder,foreignTest,"F"]])
      await put("order_items",id,
        "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) "+
        "VALUES(?,?,?,?,?,'AED',NOW(3))",[id,ord,test,label+code,"Stage79 Test"]);
    for(let i=0;i<345;i++){
      const tenant=i<342?org:foreignOrg;
      const branchId=i<330?branch:i<342?restrictedBranch:foreignBranch;
      const status=i<330?"OPEN":i<342?"OPEN":"OPEN";
      const due=i<310?new Date(Date.UTC(2026,9,10,0,i)):i<320
        ?new Date(Date.UTC(2026,9,12,0,i)):i<330?null
        :new Date(Date.UTC(2026,9,10,0,i));
      const detected=new Date(Date.UTC(2026,9,9,0,i));
      fixtures.push({resultId:randomUUID(),eventId:randomUUID(),due,detected,branchId,tenant,status});
    }
    // Include a closed event in the authorized branch; it must never appear.
    fixtures.push({resultId:randomUUID(),eventId:randomUUID(),
      due:new Date(Date.UTC(2026,9,10)),detected:new Date(Date.UTC(2026,9,9)),
      branchId:branch,tenant:org,status:"ACKNOWLEDGED"});
    await batch(
      "INSERT INTO laboratory_results(id,organization_id,order_item_id,performing_branch_id,version,status,entered_by_user_id,updated_at) VALUES ",
      fixtures.map((v,i)=>[v.resultId,v.tenant,v.tenant===org?itemId:foreignItem,
        v.branchId,v.tenant===org?i+1:i-341,"RELEASED",v.tenant===org?actor:foreignActor,
        date(new Date("2026-10-10T00:00:00.000Z"))!].filter(()=>true))
    );
    await batch(
      "INSERT INTO critical_result_events(id,result_id,status,critical_value_snapshot,detected_at,acknowledgement_due_at,updated_at) VALUES ",
      fixtures.map(v=>[v.eventId,v.resultId,v.status,"[]",date(v.detected)!,date(v.due),date(now)!])
    );
    assert.equal(await count("all"),330);
    assert.equal(await count("overdue"),310);
    for(const filter of ["all","overdue"] as const){
      const visited=new Set<string>();
      let cursor:CriticalQueuePosition|null=null;
      let pages=0;
      let seenNull=false;
      while(true){
        const data=await loadPage(filter,cursor);
        const page=criticalQueuePage(data,filter);
        assert.ok(page.rows.length<=50);
        for(const entry of page.rows){
          assert.equal(visited.has(entry.id),false,"duplicate page event");
          visited.add(entry.id);
          if(entry.acknowledgementDueAt===null)seenNull=true;
          else assert.equal(seenNull,false,"NULL due incorrectly sorted before due event");
          if(filter==="overdue"){
            assert.ok(entry.acknowledgementDueAt && entry.acknowledgementDueAt<=now);
          }
        }
        pages++;
        if(!page.hasNext){
          assert.equal(page.nextCursor,null);
          break;
        }
        assert.ok(page.nextCursor);
        cursor=decodeCriticalQueueCursor(page.nextCursor,filter);
        assert.ok(cursor);
        assert.ok(pages<12,"pagination must make progress");
      }
      assert.equal(visited.size,filter==="all"?330:310);
      assert.ok(pages>6,"should pass old 300-record cap");
      for(const v of fixtures.slice(330)){
        assert.equal(visited.has(v.eventId),false,"foreign/restricted/closed event disclosed");
      }
    }
  }finally{
    await writer.execute("DELETE FROM critical_result_events WHERE result_id IN "+
      "(SELECT id FROM laboratory_results WHERE order_item_id IN (?,?))",[itemId,foreignItem]).catch(()=>{});
    await writer.execute("DELETE FROM laboratory_results WHERE order_item_id IN (?,?)",[itemId,foreignItem]).catch(()=>{});
    for(const row of cleanup)await writer.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
