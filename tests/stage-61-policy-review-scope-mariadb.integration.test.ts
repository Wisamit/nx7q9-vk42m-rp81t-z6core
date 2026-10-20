import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { policyReviewIdentityScope } from "../src/lib/catalog-policy-review-scope.ts";

test("Stage 61 MariaDB: staged identities fail closed on revoked branch and changed live department", {
  timeout: 45000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = {host:url.hostname,port:Number(url.port || 3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [writer, reviewer] = await Promise.all([
    mysql.createConnection(cfg), mysql.createConnection(cfg),
  ]);
  const org=randomUUID(),otherOrg=randomUUID(),branchA=randomUUID(),branchB=randomUUID();
  const deptA=randomUUID(),deptB=randomUUID(),testId=randomUUID(),unitId=randomUUID();
  const listId=randomUUID(),batch=randomUUID(),actor=randomUUID();
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  const prefix="S61"+org.slice(0,8);
  const write=(sql:string,params:(string|number|null)[])=>writer.execute(sql,params);
  try {
    for(const [id,code] of [[org,"A"],[otherOrg,"F"]])
      await write("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+code,"Stage61"]);
    for(const [id,code] of [[branchA,"A"],[branchB,"B"]])
      await write("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+code,"Stage61 Branch"]);
    for(const [id,branch,code] of [[deptA,branchA,"D1"],[deptB,branchB,"D2"]])
      await write("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,org,branch,prefix+code,"Stage61 Department"]);
    await write("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [testId,org,deptA,prefix+"T","Stage61 Test"]);
    await write("INSERT INTO units(id,organization_id,code,symbol,updated_at) VALUES(?,?,?,?,NOW(3))",
      [unitId,org,prefix+"U","mg/dL"]);
    await write("INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES(?,?,?,?,'BRANCH',?,'AED','2025-01-01',NOW(3))",
      [listId,org,prefix+"P","Stage61 List",branchB]);
    await write("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor,org,prefix+"USER","Stage61 Author"]);
    await write("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage61.json',?,'DRAFT',?,NOW(3))",
      [batch,org,"f".repeat(64),actor]);
    const rows = [
      {entityType:"TEST",id:testId,normalized:{id:testId,departmentId:deptA}},
      {entityType:"UNIT",id:unitId,normalized:{id:unitId}},
      {entityType:"PRICE_LIST",id:listId,normalized:{
        id:listId,scopeType:"BRANCH",branchId:branchB}},
    ];
    for (const [i,row] of rows.entries()) await write(
      "INSERT INTO catalog_import_rows(id,batch_id,\u0060row_number\u0060,entity_type,status,legacy_key,source_data,normalized_data,validation_issues,updated_at) VALUES(?,?,?,?,'WARNING',?,?,?,?,NOW(3))",
      [ids[i],batch,i+1,row.entityType,row.id,JSON.stringify(row.entityType==="PRICE_LIST"
        ? {id:row.id,code:prefix+"P",currency:"AED",scopeType:"BRANCH",
          branchId:branchB,status:"ACTIVE",sourceId:null,referrerId:null,
          clientId:null,contractId:null}
        : {id:row.id}),
        JSON.stringify(row.entityType==="PRICE_LIST"
          ? {...row.normalized,code:prefix+"P",currency:"AED",status:"ACTIVE"}
          : row.normalized),JSON.stringify([{severity:"WARNING",code:"REVIEW_ONLY"}])]);
    const [staged]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT entity_type AS entityType,source_data AS sourceData,normalized_data AS normalizedData,status,imported_entity_id AS importedEntityId FROM catalog_import_rows WHERE batch_id=? ORDER BY \u0060row_number\u0060",
      [batch]);
    const decoded=staged.map(row=>({
      entityType:String(row.entityType),
      sourceData:typeof row.sourceData==="string"?JSON.parse(row.sourceData):row.sourceData,
      normalizedData:typeof row.normalizedData==="string"?JSON.parse(row.normalizedData):row.normalizedData,
      status:String(row.status), importedEntityId:row.importedEntityId as string|null,
    }));
    assert.deepEqual(policyReviewIdentityScope(decoded,new Set([branchA])),{
      ok:false,error:"policy_review_batch_scope_changed",
    });
    const permitted=policyReviewIdentityScope(decoded,new Set([branchA,branchB]));
    assert.equal(permitted.ok,true);
    const [authorized]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT t.id FROM lab_tests t JOIN departments d ON d.id=t.department_id WHERE t.organization_id=? AND t.id=? AND d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?)",
      [org,testId,branchA]);
    assert.equal(authorized.length,1);
    await write("UPDATE lab_tests SET department_id=?,updated_at=NOW(3) WHERE id=?",
      [deptB,testId]);
    const [revoked]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT t.id FROM lab_tests t JOIN departments d ON d.id=t.department_id WHERE t.organization_id=? AND t.id=? AND d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?)",
      [org,testId,branchA]);
    assert.equal(revoked.length,0);
    const [foreign]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=?",[testId,otherOrg]);
    assert.equal(foreign.length,0);
    const [notApplied]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM catalog_import_rows WHERE batch_id=? AND imported_entity_id IS NOT NULL",
      [batch]);
    assert.equal(Number(notApplied[0].n),0);
  } finally {
    await writer.rollback().catch(()=>{});
    await write("DELETE FROM catalog_import_rows WHERE batch_id=?",[batch]).catch(()=>{});
    await write("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await write("DELETE FROM price_lists WHERE id=?",[listId]).catch(()=>{});
    await write("DELETE FROM lab_tests WHERE id=?",[testId]).catch(()=>{});
    await write("DELETE FROM units WHERE id=?",[unitId]).catch(()=>{});
    await write("DELETE FROM departments WHERE id IN (?,?)",[deptA,deptB]).catch(()=>{});
    await write("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
    await write("DELETE FROM branches WHERE id IN (?,?)",[branchA,branchB]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id IN (?,?)",[org,otherOrg]).catch(()=>{});
    await Promise.all([writer.end(),reviewer.end()]);
  }
});
