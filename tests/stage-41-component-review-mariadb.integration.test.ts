import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { blockedComponentReviewRow, componentCsvReviewAllowed,
  isReviewableComponentStatus } from "../src/lib/component-review-disclosure.ts";

test("Stage 41 MariaDB two sessions: CSV component ownership and non-reviewable rows cannot become review candidates",
  { timeout: 45000 }, async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    const url=new URL(process.env.DATABASE_URL);
    const cfg={host:url.hostname,port:Number(url.port||3306),
      user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
      database:url.pathname.slice(1)};
    const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
    const org=randomUUID(),other=randomUUID(),owner=randomUUID(),colleague=randomUUID();
    const outsider=randomUUID(),batch=randomUUID(),foreignBatch=randomUUID();
    const suffix=org.slice(0,8);
    const exec=(sql:string,args:(string|number|null)[])=>writer.execute(sql,args);
    try {
      for(const [id,code] of [[org,"A"],[other,"B"]])
        await exec("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
          [id,"C41"+suffix+code,"Component Privacy"]);
      for(const [id,tenant,label] of [[owner,org,"OWN"],[colleague,org,"COL"],[outsider,other,"OUT"]])
        await exec("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
          [id,tenant,"c41"+suffix+label,"Component Reviewer"]);
      for(const [id,tenant,creator] of [[batch,org,owner],[foreignBatch,other,outsider]])
        await exec("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,created_by_user_id,updated_at) VALUES (?,?,'CSV_REVIEW','component-review.csv',?,NOW(3))",
          [id,tenant,creator]);

      const statuses=["WARNING","ERROR","IMPORTED","SKIPPED","VALID"] as const;
      const numbers=[1,2,3,4,101];
      for(let i=0;i<statuses.length;i++){
        const source=JSON.stringify({testCode:"TEST-A",code:"COMP-X",nameEn:"Sensitive source "+i,
          unitCode:"",resultType:"NUMERIC"});
        await exec("INSERT INTO catalog_import_rows(id,batch_id,row_number,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,?,'COMPONENT',?,?,?,NOW(3))",
          [randomUUID(),batch,numbers[i],statuses[i],source,source]);
      }
      const otherSource=JSON.stringify({testCode:"OTHER",code:"COMP-FOREIGN",nameEn:"Foreign laboratory"});
      await exec("INSERT INTO catalog_import_rows(id,batch_id,row_number,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,1,'COMPONENT','VALID',?,?,NOW(3))",
        [randomUUID(),foreignBatch,otherSource,otherSource]);

      const [accessible]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,source_type,created_by_user_id FROM catalog_import_batches WHERE id=? AND organization_id=?",
        [batch,org]);
      const [inaccessible]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM catalog_import_batches WHERE id=? AND organization_id=?",
        [foreignBatch,org]);
      assert.equal(inaccessible.length,0);
      assert.equal(accessible.length,1);
      const source={sourceType:String(accessible[0].source_type),
        createdByUserId:String(accessible[0].created_by_user_id)};
      assert.equal(componentCsvReviewAllowed(source,owner),true);
      assert.equal(componentCsvReviewAllowed(source,colleague),false);

      const [all]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT row_number,status,normalized_data FROM catalog_import_rows WHERE batch_id=? AND entity_type='COMPONENT' ORDER BY row_number,id",
        [batch]);
      assert.deepEqual(all.map(x=>Number(x.row_number)),numbers);
      const [eligible]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT row_number,status,normalized_data FROM catalog_import_rows WHERE batch_id=? AND entity_type='COMPONENT' AND status IN ('VALID','WARNING') LIMIT 20001",
        [batch]);
      assert.deepEqual(eligible.map(x=>Number(x.row_number)).sort((a,b)=>a-b),[1,101]);
      assert.ok(eligible.every(x=>isReviewableComponentStatus(String(x.status))));
      for(const nonreviewable of all.filter(x=>!isReviewableComponentStatus(String(x.status)))){
        const safe=blockedComponentReviewRow({rowNumber:Number(nonreviewable.row_number),
          status:String(nonreviewable.status)});
        assert.equal(safe.candidate,null);
        assert.equal(safe.resolvedTestId,null);
        assert.equal(safe.resolvedUnitId,null);
        assert.deepEqual(safe.stagedIssues,[]);
      }
      // Duplicate reviewable identities across page boundaries remain visible;
      // error/imported/skipped rows must not invent additional collisions.
      const codes=eligible.map(x=>JSON.parse(String(x.normalized_data)).code);
      assert.deepEqual(codes,["COMP-X","COMP-X"]);
    } finally {
      await exec("DELETE FROM catalog_import_rows WHERE batch_id IN (?,?)",[batch,foreignBatch]).catch(()=>{});
      await exec("DELETE FROM catalog_import_batches WHERE id IN (?,?)",[batch,foreignBatch]).catch(()=>{});
      await exec("DELETE FROM users WHERE id IN (?,?,?)",[owner,colleague,outsider]).catch(()=>{});
      await exec("DELETE FROM organizations WHERE id IN (?,?)",[org,other]).catch(()=>{});
      await Promise.all([writer.end(),reader.end()]);
    }
  });
