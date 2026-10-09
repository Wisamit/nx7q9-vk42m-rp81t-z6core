import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { rangeReviewCandidate, stagedRangeContextIndex, stagedRangeContextIssue,
  stagedRangeAgeOverlapIndex, stagedRangeAgeOverlapIssue } from "../src/lib/catalog-range-import-reconciliation.ts";

test("MariaDB independent sessions: paged range-review evidence is uploader/tenant scoped and read-only",
  { timeout: 45000 }, async () => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    const url = new URL(process.env.DATABASE_URL);
    const cfg = { host: url.hostname, port: Number(url.port || 3306),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: url.pathname.slice(1) };
    const [writer, reviewer] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
    const org = randomUUID(), otherOrg = randomUUID(), uploader = randomUUID();
    const colleague = randomUUID(), otherUser = randomUUID();
    const batch = randomUUID(), otherBatch = randomUUID(), suffix = org.slice(0,8);
    const sql = (statement: string, params: Array<string|number>) => writer.execute(statement, params);
    const range = (from: string, to: string) => ({
      testName:"HGB",unit:"g/dL",sex:"FEMALE",ageFrom:from,ageTo:to,
      ageUnit:"YEAR",low:"12.5",high:"16",normalTextEn:"",
    });
    const insert = async (id: string, rowNumber: number, status: string, data: ReturnType<typeof range>) => {
      const json = JSON.stringify(data);
      await sql("INSERT INTO catalog_import_rows (id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,?,'REFERENCE_INTERVAL',?,?,?,NOW(3))",
        [randomUUID(),id,rowNumber,status,json,json]);
    };
    try {
      for (const [id,code] of [[org,"OWN"],[otherOrg,"OTHER"]]) {
        await sql("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
          [id,"ST37-"+suffix+code,"Clinical Review"]);
      }
      for (const [id,owner,code] of [[uploader,org,"AUTHOR"],[colleague,org,"COLLEAGUE"],[otherUser,otherOrg,"FOREIGN"]]) {
        await sql("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
          [id,owner,"st37-"+suffix+code,"Clinical Reviewer"]);
      }
      for (const [id,owner,actor] of [[batch,org,uploader],[otherBatch,otherOrg,otherUser]]) {
        await sql("INSERT INTO catalog_import_batches (id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES (?,?,'CSV_REVIEW','range-review.csv','DRAFT',?,NOW(3))",
          [id,owner,actor]);
      }
      await insert(batch,1,"WARNING",range("0","5"));
      for (let i=2; i<=100; i++) await insert(batch,i,"WARNING",
        {...range("0","1"),testName:"OTHER_"+i});
      await insert(batch,101,"WARNING",range("4","9"));
      await insert(batch,102,"ERROR",range("0","5"));
      await insert(batch,103,"IMPORTED",range("0","5"));
      await insert(batch,104,"SKIPPED",range("0","5"));
      await insert(otherBatch,1,"WARNING",range("2","10"));

      const [allowed] = await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM catalog_import_batches WHERE id=? AND organization_id=? AND source_type='CSV_REVIEW' AND created_by_user_id=?",
        [batch,org,uploader]);
      assert.equal(allowed.length,1);
      for (const [tenant,user] of [[org,colleague],[otherOrg,otherUser]]) {
        const [denied]=await reviewer.execute<mysql.RowDataPacket[]>(
          "SELECT id FROM catalog_import_batches WHERE id=? AND organization_id=? AND source_type='CSV_REVIEW' AND created_by_user_id=?",
          [batch,tenant,user]);
        assert.equal(denied.length,0);
      }
      const fetchPage = async (after:number) => {
        const [rows]=await reviewer.execute<mysql.RowDataPacket[]>(
          "SELECT `row_number` AS rowNumber,status,normalized_data AS normalizedData FROM catalog_import_rows WHERE batch_id=? AND entity_type='REFERENCE_INTERVAL' AND `row_number`>? ORDER BY `row_number` ASC,id ASC LIMIT 101",
          [batch,after]);
        return rows;
      };
      const first = await fetchPage(0);
      assert.equal(first.length,101);
      assert.equal(Number(first[99].rowNumber),100);
      const second = await fetchPage(Number(first[99].rowNumber));
      assert.deepEqual(second.map(row=>Number(row.rowNumber)),[101,102,103,104]);
      const previous = await fetchPage(0);
      assert.equal(Number(previous[0].rowNumber),1);
      const [candidates]=await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT normalized_data AS normalizedData,status FROM catalog_import_rows WHERE batch_id=? AND entity_type='REFERENCE_INTERVAL' AND status IN ('VALID','WARNING') LIMIT 20001",
        [batch]);
      const eligible = candidates.map(row=>({ status:String(row.status),
        normalizedData:typeof row.normalizedData==="string" ? JSON.parse(row.normalizedData) : row.normalizedData }));
      const contextIndex = stagedRangeContextIndex(eligible);
      const overlapIndex = stagedRangeAgeOverlapIndex(eligible);
      const a=rangeReviewCandidate(range("0","5"));
      assert.equal(stagedRangeAgeOverlapIssue(a,overlapIndex),"POTENTIAL_STAGED_AGE_WINDOW_OVERLAP");
      assert.equal(stagedRangeContextIssue(a,contextIndex),null,
        "ERROR/IMPORTED/SKIPPED must not fabricate duplicate warnings");
      const [untouched]=await reviewer.execute<mysql.RowDataPacket[]>(
        "SELECT status,COUNT(*) AS qty FROM catalog_import_rows WHERE batch_id=? GROUP BY status",[batch]);
      assert.deepEqual(Object.fromEntries(untouched.map(row=>[String(row.status),Number(row.qty)])),
        { WARNING:101, ERROR:1, IMPORTED:1, SKIPPED:1 });
    } finally {
      await sql("DELETE FROM catalog_import_rows WHERE batch_id IN (?,?)",[batch,otherBatch]).catch(()=>{});
      await sql("DELETE FROM catalog_import_batches WHERE id IN (?,?)",[batch,otherBatch]).catch(()=>{});
      await sql("DELETE FROM users WHERE id IN (?,?,?)",[uploader,colleague,otherUser]).catch(()=>{});
      await sql("DELETE FROM organizations WHERE id IN (?,?)",[org,otherOrg]).catch(()=>{});
      await Promise.all([writer.end(),reviewer.end()]);
    }
  });
