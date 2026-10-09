import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { stagedRangeContextIndex, stagedRangeContextIssue, rangeReviewCandidate } from "../src/lib/catalog-range-import-reconciliation.ts";

test("MariaDB two sessions: staged context conflict across page 100/101 remains tenant- and batch-bound", {timeout:45000}, async()=>{
  if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),other=randomUUID(),user=randomUUID(),otherUser=randomUUID(),batch=randomUUID(),otherBatch=randomUUID();
  const suffix=org.slice(0,8);
  const inserted:string[]=[];
  const run=(q:string,p: Array<string|number>)=>writer.execute(q,p);
  const value=(high:string,low="12.500000")=>({
    testName:"HGB",unit:"g/dL",sex:"ANY",ageFrom:"0.000",ageTo:"18.0",
    ageUnit:"YEAR",low,high,normalTextEn:"",
  });
  const insertRow=async(batchId:string,rowNumber:number,v:ReturnType<typeof value>,status="WARNING")=>{
    const id=randomUUID();inserted.push(id);
    const json=JSON.stringify(v);
    await run("INSERT INTO catalog_import_rows (id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,?,'REFERENCE_INTERVAL',?,?,?,NOW(3))",
      [id,batchId,rowNumber,status,json,json]);
  };
  try{
    for(const [id,code] of [[org,"OWN"],[other,"OTHER"]]){
      await run("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,"ST35-"+suffix+code,"Staged Context"]);
    }
    for(const [id,tenant,name] of [[user,org,"A"],[otherUser,other,"B"]]){
      await run("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,tenant,"st35-"+suffix+name,"Stage 35"]);
    }
    for(const [id,tenant,actor] of [[batch,org,user],[otherBatch,other,otherUser]]){
      await run("INSERT INTO catalog_import_batches (id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES (?,?,'CSV_REVIEW','ranges.csv','DRAFT',?,NOW(3))",
        [id,tenant,actor]);
    }
    await insertRow(batch,1,value("15.750"));
    for(let i=2;i<=100;i++) await insertRow(batch,i,{
      ...value("15.750"),testName:"UNRELATED_"+i,
    });
    await insertRow(batch,101,value("015.7500","012.5")); // same clinical bounds, far page
    await insertRow(batch,102,value("16.000")); // same age/sex context, different bounds
    await insertRow(batch,103,value("80.000"),"ERROR"); // invalid staged row excluded
    await insertRow(otherBatch,1,value("999.000")); // cross-tenant source excluded
    const [records]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT normalized_data AS normalizedData,status FROM catalog_import_rows WHERE batch_id=? AND entity_type='REFERENCE_INTERVAL' AND status IN ('VALID','WARNING') ORDER BY `row_number` LIMIT 20001",
      [batch]);
    const candidates=records.map(row=>({
      status:String(row.status),
      normalizedData:typeof row.normalizedData==="string"?JSON.parse(row.normalizedData):row.normalizedData,
    }));
    assert.equal(candidates.length,102);
    const index=stagedRangeContextIndex(candidates);
    const result=stagedRangeContextIssue(rangeReviewCandidate(value("15.750")),index);
    assert.equal(result,"CONFLICTING_STAGED_RANGE_CONTEXT");
    const [foreign]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM catalog_import_rows WHERE batch_id=?",[otherBatch]);
    assert.equal(foreign.length,1);
    const [ours]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS qty FROM catalog_import_rows WHERE batch_id=?",[batch]);
    assert.equal(Number(ours[0].qty),103,"read-only review did not modify staged data");
  }finally{
    await run("DELETE FROM catalog_import_rows WHERE batch_id IN (?,?)",[batch,otherBatch]).catch(()=>{});
    await run("DELETE FROM catalog_import_batches WHERE id IN (?,?)",[batch,otherBatch]).catch(()=>{});
    await run("DELETE FROM users WHERE id IN (?,?)",[user,otherUser]).catch(()=>{});
    await run("DELETE FROM organizations WHERE id IN (?,?)",[org,other]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
