import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { policyReviewIdentityScope } from "../src/lib/catalog-policy-review-scope.ts";

test("F2 MariaDB: reviewed panel, package, package tariff and container cannot bypass nested live branch/private price scope",
{timeout: 60000}, async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={host:u.hostname,port:Number(u.port||3306),
    user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),
    database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branchA=randomUUID(),branchB=randomUUID();
  const deptA=randomUUID(),deptB=randomUUID(),testA=randomUUID(),testB=randomUUID();
  const panel=randomUUID(),pkg=randomUUID(),list=randomUUID(),pkgPrice=randomUUID();
  const tube=randomUUID(),batch=randomUUID(),author=randomUUID();
  const ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID()];
  const prefix="F2PS"+org.slice(0,8);
  const write=(sql:string,params:Array<string|number|null>)=>writer.execute(sql,params);
  // An independent REPEATABLE READ session acquires the same tenant lock as
  // the policy reviewer route. SQL probes exercise real FK/branch visibility;
  // pure tests separately bind the route to the Prisma scope validator.
  const check=async()=>{
    await reader.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await reader.beginTransaction();
    try{
      const [locked]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
      assert.equal(locked.length,1);
      const [staged]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT entity_type,source_data,normalized_data,status,imported_entity_id FROM catalog_import_rows WHERE batch_id=? ORDER BY `row_number`",[batch]);
      const json=(v:unknown)=>typeof v==="string"?JSON.parse(v):v;
      const identities=staged.map(r=>({
        entityType:String(r.entity_type),sourceData:json(r.source_data),
        normalizedData:json(r.normalized_data),status:String(r.status),
        importedEntityId:r.imported_entity_id as string|null,
      }));
      const review=policyReviewIdentityScope(identities,new Set([branchA]));
      if(!review.ok)return review;
      const [panels]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT p.id FROM test_panels p WHERE p.id=? AND p.organization_id=? AND EXISTS (SELECT 1 FROM test_panel_items i WHERE i.panel_id=p.id) AND NOT EXISTS (SELECT 1 FROM test_panel_items i JOIN lab_tests t ON t.id=i.test_id LEFT JOIN departments d ON d.id=t.department_id WHERE i.panel_id=p.id AND (t.organization_id<>? OR t.department_id<>? OR t.status<>'ACTIVE' OR d.status<>'ACTIVE' OR d.branch_id<>?))",
        [panel,org,org,deptA,branchA]);
      const [packages]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT p.id FROM commercial_packages p WHERE p.id=? AND p.organization_id=? AND EXISTS (SELECT 1 FROM commercial_package_items i WHERE i.package_id=p.id) AND NOT EXISTS (SELECT 1 FROM commercial_package_items i JOIN lab_tests t ON t.id=i.test_id LEFT JOIN departments d ON d.id=t.department_id WHERE i.package_id=p.id AND (t.organization_id<>? OR t.department_id<>? OR t.status<>'ACTIVE' OR d.status<>'ACTIVE' OR d.branch_id<>?))",
        [pkg,org,org,deptA,branchA]);
      const [tariffs]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT p.id FROM price_list_package_items p JOIN price_lists l ON l.id=p.price_list_id JOIN commercial_packages k ON k.id=p.package_id WHERE p.id=? AND p.package_id=? AND k.organization_id=? AND l.organization_id=? AND l.scope_type='BRANCH' AND l.branch_id=? AND l.source_id IS NULL AND l.referrer_id IS NULL AND l.client_id IS NULL AND l.contract_id IS NULL",
        [pkgPrice,pkg,org,org,branchA]);
      const [containers]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM containers WHERE id=? AND organization_id=?",[tube,org]);
      return panels.length===1 && packages.length===1 && tariffs.length===1 && containers.length===1
        ? {ok:true} as const
        : {ok:false,error:"policy_review_batch_scope_changed"} as const;
    }finally{await reader.rollback().catch(()=>{});}
  };
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
    const date="2026-01-01T00:00:00.000Z";
    const records=[
      {type:"PANEL",source:{id:panel,items:[
        {testId:testA,displayOrder:1,required:true,test:{code:prefix+"A"}}]},
        normalized:{id:panel,items:[{testId:testA,testCode:prefix+"A",displayOrder:1,required:true}]}},
      {type:"PACKAGE",source:{id:pkg,items:[
        {testId:testA,displayOrder:1,test:{code:prefix+"A"}}]},
        normalized:{id:pkg,items:[{testId:testA,testCode:prefix+"A",displayOrder:1}]}},
      {type:"PRICE_LIST_PACKAGE_ITEM",source:{
        id:pkgPrice,priceListId:list,packageId:pkg,package:{code:prefix+"K"},
        priceList:{code:prefix+"L",scopeType:"BRANCH",branchId:branchA,
          currency:"AED",sourceId:null,referrerId:null,clientId:null,contractId:null},
        unitPrice:"123.4500",effectiveFrom:date,effectiveTo:null,status:"ACTIVE",
      },normalized:{id:pkgPrice,packageId:pkg,packageCode:prefix+"K",
        priceListId:list,priceListCode:prefix+"L",scopeType:"BRANCH",
        branchId:branchA,currency:"AED",unitPrice:"123.4500",
        effectiveFrom:date,effectiveTo:null,status:"ACTIVE"}},
      {type:"CONTAINER",source:{id:tube},normalized:{id:tube}},
    ];
    for(const [i,row] of records.entries()){
      await write("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES(?,?,?,?,'WARNING',?,?,NOW(3))",
        [ids[i],batch,i+1,row.type,JSON.stringify(row.source),JSON.stringify(row.normalized)]);
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
    await Promise.all([writer.end(),reader.end()]);
  }
});
