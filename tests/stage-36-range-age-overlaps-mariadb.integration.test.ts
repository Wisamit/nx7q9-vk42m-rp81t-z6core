import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { stagedRangeAgeOverlapIndex, stagedRangeAgeOverlapIssue, rangeReviewCandidate } from "../src/lib/catalog-range-import-reconciliation.ts";

test("MariaDB independent sessions: intersecting age windows across pages stay bounded to uploader batch and tenant",
  {timeout:45000}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),actor=randomUUID(),foreignActor=randomUUID();
  const batch=randomUUID(),foreignBatch=randomUUID(),suffix=org.slice(0,8);
  const run=(sql:string,args:Array<string|number>)=>writer.execute(sql,args);
  const clinical=(start:string,end:string)=>({
    testName:"HGB",unit:"g/dL",sex:"FEMALE",ageFrom:start,ageTo:end,
    ageUnit:"YEAR",low:"12.50",high:"16.00",normalTextEn:"",
  });
  const insert=async(id:string,number:number,data:ReturnType<typeof clinical>,status="WARNING")=>{
    const json=JSON.stringify(data);
    await run("INSERT INTO catalog_import_rows (id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,?,'REFERENCE_INTERVAL',?,?,?,NOW(3))",
      [randomUUID(),id,number,status,json,json]);
  };
  try {
    for(const [id,code] of [[org,"OWN"],[foreignOrg,"FOREIGN"]]){
      await run("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
        [id,"ST36-"+suffix+code,"Age Window Review"]);
    }
    for(const [id,tenant,code] of [[actor,org,"A"],[foreignActor,foreignOrg,"B"]]){
      await run("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [id,tenant,"st36-"+suffix+code,"Range Reviewer"]);
    }
    for(const [id,tenant,uploader] of [[batch,org,actor],[foreignBatch,foreignOrg,foreignActor]]){
      await run("INSERT INTO catalog_import_batches (id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES (?,?,'CSV_REVIEW','ranges.csv','DRAFT',?,NOW(3))",
        [id,tenant,uploader]);
    }
    const first=clinical("0.000","5.000");
    const later=clinical("4.000","10.000");
    await insert(batch,1,first);
    for(let number=2;number<=100;number++){
      await insert(batch,number,{...clinical("0","1"),testName:"OTHER_"+number});
    }
    await insert(batch,101,later);
    await insert(batch,102,clinical("2","8"),"ERROR");
    await insert(foreignBatch,1,clinical("3","12"));
    const [local]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT normalized_data AS normalizedData,status FROM catalog_import_rows WHERE batch_id=? AND entity_type='REFERENCE_INTERVAL' AND status IN ('VALID','WARNING') ORDER BY `row_number` LIMIT 20001",
      [batch]);
    assert.equal(local.length,101);
    const candidateRows=local.map(row=>({
      status:String(row.status),
      normalizedData:typeof row.normalizedData==="string"?JSON.parse(row.normalizedData):row.normalizedData,
    }));
    const index=stagedRangeAgeOverlapIndex(candidateRows);
    assert.equal(stagedRangeAgeOverlapIssue(rangeReviewCandidate(first),index),"POTENTIAL_STAGED_AGE_WINDOW_OVERLAP");
    assert.equal(stagedRangeAgeOverlapIssue(rangeReviewCandidate(later),index),"POTENTIAL_STAGED_AGE_WINDOW_OVERLAP");
    const pageOne=stagedRangeAgeOverlapIndex(candidateRows.slice(0,100));
    assert.equal(stagedRangeAgeOverlapIssue(rangeReviewCandidate(first),pageOne),null,
      "whole-batch source check must detect intersections missed across pages");
    const [crossTenant]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS qty FROM catalog_import_rows WHERE batch_id=?",[foreignBatch]);
    assert.equal(Number(crossTenant[0].qty),1);
    const [persisted]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS qty FROM catalog_import_rows WHERE batch_id=?",[batch]);
    assert.equal(Number(persisted[0].qty),102,"advisory review did not modify staged rows");
  } finally {
    await run("DELETE FROM catalog_import_rows WHERE batch_id IN (?,?)",[batch,foreignBatch]).catch(()=>{});
    await run("DELETE FROM catalog_import_batches WHERE id IN (?,?)",[batch,foreignBatch]).catch(()=>{});
    await run("DELETE FROM users WHERE id IN (?,?)",[actor,foreignActor]).catch(()=>{});
    await run("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
