import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { prisma } from "../src/lib/db.ts";
import { validatePolicyReviewBatchScope } from "../src/lib/catalog-policy-review-scope.ts";

test("F2 MariaDB: reviewed panel, package, package tariff and container cannot bypass nested live branch/private price scope",
{timeout: 60000}, async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const writer=await mysql.createConnection({host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)});
  const org=randomUUID(),foreignOrg=randomUUID(),branchA=randomUUID(),branchB=randomUUID();
  const deptA=randomUUID(),deptB=randomUUID(),testA=randomUUID(),testB=randomUUID();
  const panel=randomUUID(),pkg=randomUUID(),list=randomUUID(),pkgPrice=randomUUID();
  const tube=randomUUID(),batch=randomUUID(),author=randomUUID();
  const ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  const prefix="F2PS"+org.slice(0,8);
  const write=(sql:string,params:Array<string|number|null>)=>writer.execute(sql,params);
  const scope={organizationId:org,branchId:branchA,departmentIds:[deptA]};
  const check=()=>prisma.$transaction(tx=>validatePolicyReviewBatchScope(tx,{
    batchId:batch,scope,grantedBranchIds:[branchA],
  }),{isolationLevel:"RepeatableRead",timeout:15000});
  try{
    for(const [id,suffix] of [[org,"A"],[foreignOrg,"X"]])
      await write("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+suffix,"F2 isolated policy review"]);
    for(const [id,suffix] of [[branchA,"A"],[branchB,"B"]])
      await write("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+suffix,"F2 branch"]);
    for(const [id,branch,suffix] of [[deptA,branchA,"A"],[deptB,branchB,"B"]])
      await write("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,org,branch,prefix+suffix,"F2 dept"]);
    for(const [id,department,suffix] of [[testA,deptA,"A"],[testB,deptB,"B"]])
      await write("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,org,department,prefix+suffix,"F2 test"]);
    await write("INSERT INTO containers(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [tube,org,prefix+"T","Tube"]);
    await write("INSERT INTO test_panels(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [panel,org,prefix+"P","F2 panel"]);
    await write("INSERT INTO test_panel_items(panel_id,test_id,display_order,required) VALUES(?,?,1,1)",
      [panel,testA]);
    await write("INSERT INTO commercial_packages(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [pkg,org,prefix+"K","F2 package"]);
    await write("INSERT INTO commercial_package_items(package_id,test_id,display_order) VALUES(?,?,1)",
      [pkg,testA]);
    await write("INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES(?,?,?,?,'BRANCH',?,'AED','2026-01-01',NOW(3))",
      [list,org,prefix+"L","F2 tariff",branchA]);
    await write("INSERT INTO price_list_package_items(id,price_list_id,package_id,unit_price,effective_from,updated_at) VALUES(?,?,?,123.4500,'2026-01-01',NOW(3))",
      [pkgPrice,list,pkg]);
    await write("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [author,org,prefix+"U","F2 synthetic author"]);
    await write("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','test-only.json',?,'DRAFT',?,NOW(3))",
      [batch,org,"a".repeat(64),author]);
    const records=[
      ["PANEL",panel,{id:panel,items:[{testId:testA,testCode:prefix+"A",displayOrder:1,required:true}]}],
      ["PACKAGE",pkg,{id:pkg,items:[{testId:testA,testCode:prefix+"A",displayOrder:1}]}],
      ["PRICE_LIST_PACKAGE_ITEM",pkgPrice,{id:pkgPrice,packageId:pkg,
        priceListId:list,scopeType:"BRANCH",branchId:branchA}],
      ["CONTAINER",tube,{id:tube}],
    ] as const;
    for(const [i,row] of records.entries()){
      const source={id:row[1],...(row[0]==="PRICE_LIST_PACKAGE_ITEM"?
        {priceList:{scopeType:"BRANCH",branchId:branchA,
          sourceId:null,referrerId:null,clientId:null,contractId:null}}:{})};
      await write("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES(?,?,?,?,'WARNING',?,?,NOW(3))",
        [ids[i],batch,i+1,row[0],JSON.stringify(source),JSON.stringify(row[2])]);
    }
    assert.deepEqual(await check(),{ok:true});
    // All member tests must remain visible: adding a second off-branch member
    // must revoke review of both the package and its tariff.
    await write("INSERT INTO commercial_package_items(package_id,test_id,display_order) VALUES(?,?,2)",
      [pkg,testB]);
    assert.deepEqual(await check(),{ok:false,error:"policy_review_batch_scope_changed"});
    await write("DELETE FROM commercial_package_items WHERE package_id=? AND test_id=?",[pkg,testB]);
    assert.deepEqual(await check(),{ok:true});
    await write("UPDATE price_lists SET branch_id=? WHERE id=?",[branchB,list]);
    assert.deepEqual(await check(),{ok:false,error:"policy_review_batch_scope_changed"});
    await write("UPDATE price_lists SET branch_id=? WHERE id=?",[branchA,list]);
    assert.deepEqual(await check(),{ok:true});
    await write("UPDATE containers SET organization_id=? WHERE id=?",[foreignOrg,tube]);
    assert.deepEqual(await check(),{ok:false,error:"policy_review_batch_scope_changed"});
    const [master]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT unit_price FROM price_list_package_items WHERE id=?",[pkgPrice]);
    assert.equal(String(master[0].unit_price),"123.4500");
    const [reviewRows]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM catalog_import_rows WHERE batch_id=? AND status='WARNING' AND imported_entity_id IS NULL",[batch]);
    assert.equal(Number(reviewRows[0].n),4);
  }finally{
    await writer.rollback().catch(()=>{});
    await write("DELETE FROM catalog_import_rows WHERE batch_id=?",[batch]).catch(()=>{});
    await write("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await write("DELETE FROM price_list_package_items WHERE id=?",[pkgPrice]).catch(()=>{});
    await write("DELETE FROM price_lists WHERE id=?",[list]).catch(()=>{});
    await write("DELETE FROM commercial_package_items WHERE package_id=?",[pkg]).catch(()=>{});
    await write("DELETE FROM test_panel_items WHERE panel_id=?",[panel]).catch(()=>{});
    await write("DELETE FROM commercial_packages WHERE id=?",[pkg]).catch(()=>{});
    await write("DELETE FROM test_panels WHERE id=?",[panel]).catch(()=>{});
    await write("DELETE FROM containers WHERE id=?",[tube]).catch(()=>{});
    await write("DELETE FROM lab_tests WHERE id IN (?,?)",[testA,testB]).catch(()=>{});
    await write("DELETE FROM departments WHERE id IN (?,?)",[deptA,deptB]).catch(()=>{});
    await write("DELETE FROM users WHERE id=?",[author]).catch(()=>{});
    await write("DELETE FROM branches WHERE id IN (?,?)",[branchA,branchB]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    await writer.end();
  }
});
