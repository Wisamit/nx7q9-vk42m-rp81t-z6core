import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { parseCatalogBundleForReview, BUNDLE_REVIEW_SOURCE } from "../src/lib/catalog-bundle-review.ts";
import { resolveClinicalImportScope } from "../src/lib/catalog-clinical-import-scope.ts";

test("Stage 46 MariaDB two sessions: scoped six-class bundle reviews never change clinical or price masters",
  {timeout:45000}, async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const config={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),other=randomUUID(),branchA=randomUUID(),branchB=randomUUID();
  const deptA=randomUUID(),deptB=randomUUID(),testA=randomUUID(),testB=randomUUID(),unit=randomUUID();
  const component=randomUUID(),interval=randomUUID(),list=randomUUID(),privateList=randomUUID();
  const price=randomUUID(),privatePrice=randomUUID(),actor=randomUUID(),batch=randomUUID();
  const tag=org.slice(0,8),prefix="B46"+tag,date="2026-10-10T00:00:00.000Z";
  const rowIds=Array.from({length:6},()=>randomUUID());
  const exec=(sql:string,args:(string|number|null)[])=>writer.execute(sql,args);
  try {
    for(const [id,code] of [[org,"OWN"],[other,"FOREIGN"]]){
      await exec("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+code,"Bundle Review"]);
    }
    for(const [id,code] of [[branchA,"A"],[branchB,"B"]]){
      await exec("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+code,"Bundle Branch"]);
    }
    for(const [id,branch,code] of [[deptA,branchA,"DA"],[deptB,branchB,"DB"]]){
      await exec("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,org,branch,prefix+code,"Bundle Department"]);
    }
    for(const [id,department,code] of [[testA,deptA,"TA"],[testB,deptB,"TB"]]){
      await exec("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,org,department,prefix+code,"Glucose"]);
    }
    await exec("INSERT INTO units(id,organization_id,code,symbol,updated_at) VALUES(?,?,?,?,NOW(3))",
      [unit,org,prefix+"UNIT","mg/dL"]);
    await exec("INSERT INTO test_components(id,test_id,code,name_en,unit_id,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [component,testA,prefix+"GLU","Glucose",unit]);
    await exec("INSERT INTO reference_intervals(id,component_id,branch_id,low_value,high_value,effective_from,approval_status,status,updated_at) VALUES (?,?,?,?,?,'2025-01-01','APPROVED','ACTIVE',NOW(3))",
      [interval,component,branchA,"70.000000","130.000000"]);
    for(const [id,code,scope,branch] of [
      [list,"A","BRANCH",branchA],[privateList,"PVT","CLIENT",null],
    ]){
      await exec("INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES(?,?,?,?,?,?,'AED','2025-01-01',NOW(3))",
        [id,org,prefix+code,"Bundle Price",scope,branch]);
    }
    for(const [id,priceList,amount] of [[price,list,"110.1250"],[privatePrice,privateList,"9999.9999"]]){
      await exec("INSERT INTO price_list_items(id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,priceList,testA,amount,"2025-01-01"]);
    }
    await exec("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [actor,org,"b46-"+tag,"Bundle Reviewer"]);
    const scope=resolveClinicalImportScope({
      organizationId:org,activeBranchId:branchA,
      activeBranch:{id:branchA,organizationId:org,status:"ACTIVE"},
      branchScopes:[{branchId:branchA,branch:{status:"ACTIVE"}}],
      departmentScopes:[{departmentId:deptA,department:{status:"ACTIVE",organizationId:org,branchId:branchA}}],
    });
    assert.ok(scope);
    const groups=[
      {entityType:"TEST",records:[{id:testA,code:prefix+"TA",nameEn:"Glucose",departmentId:deptA,status:"ACTIVE"}]},
      {entityType:"UNIT",records:[{id:unit,code:prefix+"UNIT",symbol:"mg/dL",status:"ACTIVE"}]},
      {entityType:"COMPONENT",records:[{id:component,code:prefix+"GLU",nameEn:"Glucose",testId:testA,
        test:{code:prefix+"TA"},unitId:unit,status:"ACTIVE"}]},
      {entityType:"REFERENCE_INTERVAL",records:[{id:interval,componentId:component,branchId:branchA,
        component:{code:prefix+"GLU",test:{code:prefix+"TA"}},lowValue:"70.000000",highValue:"130.000000",
        approvalStatus:"APPROVED",status:"ACTIVE",effectiveFrom:"2025-01-01T00:00:00.000Z"}]},
      {entityType:"PRICE_LIST",records:[{id:list,code:prefix+"A",scopeType:"BRANCH",branchId:branchA,
        currency:"AED",status:"ACTIVE"}]},
      {entityType:"PRICE_LIST_ITEM",records:[{id:price,priceListId:list,testId:testA,
        test:{code:prefix+"TA"},priceList:{code:prefix+"A",scopeType:"BRANCH",branchId:branchA},
        unitPrice:"110.1250",effectiveFrom:"2025-01-01T00:00:00.000Z",status:"ACTIVE"}]},
    ];
    const parsed=parseCatalogBundleForReview({
      format:"family-lab-catalog-bundle",schemaVersion:1,organizationId:org,
      consistency:"paged-live-not-atomic",exportedAt:date,groups,
    },org,{pricing:true,ranges:true});
    assert.equal(parsed.rows.length,6);
    assert.equal(parsed.rows[5].normalized.unitPrice,"110.1250");
    // A scoped reviewer must not resolve off-branch test identities.
    const [allowedTests]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT t.id FROM lab_tests t JOIN departments d ON d.id=t.department_id WHERE t.organization_id=? AND t.department_id=? AND (d.branch_id IS NULL OR d.branch_id=?)",
      [org,deptA,branchA]);
    assert.deepEqual(allowedTests.map(x=>String(x.id)),[testA]);
    assert.ok(!allowedTests.some(x=>String(x.id)===testB));
    const [scopePrices]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,code FROM price_lists WHERE organization_id=? AND ((scope_type='ORGANIZATION' AND branch_id IS NULL) OR (scope_type='BRANCH' AND branch_id=?))",
      [org,branchA]);
    assert.deepEqual(scopePrices.map(x=>String(x.id)),[list]);
    const [otherScope]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM price_lists WHERE organization_id=? AND scope_type='BRANCH' AND branch_id=?",
      [other,branchA]);
    assert.equal(otherScope.length,0);

    await writer.beginTransaction();
    await writer.execute(
      "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,summary,updated_at) VALUES(?,?,?,'stage46.json','DRAFT',?,?,NOW(3))",
      [batch,org,BUNDLE_REVIEW_SOURCE,actor,JSON.stringify({reviewOnly:true,total:6})]);
    for(const [i,row] of parsed.rows.entries()){
      await writer.execute(
        "INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,legacy_key,source_data,normalized_data,validation_issues,updated_at) VALUES(?,?,?,?,'WARNING',?,?,?,?,NOW(3))",
        [rowIds[i],batch,i+1,row.entityType,row.identity,JSON.stringify(row.original),
          JSON.stringify(row.normalized),JSON.stringify([{severity:"WARNING",code:"CONFIGURATION_BUNDLE_REVIEW_ONLY"}])]);
    }
    await writer.commit();
    const [reviewBatch]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT status,source_type,organization_id,created_by_user_id FROM catalog_import_batches WHERE id=?",
      [batch]);
    assert.equal(String(reviewBatch[0].status),"DRAFT");
    assert.equal(String(reviewBatch[0].source_type),BUNDLE_REVIEW_SOURCE);
    assert.equal(String(reviewBatch[0].created_by_user_id),actor);
    const [staged]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT entity_type,status,imported_entity_id FROM catalog_import_rows WHERE batch_id=? ORDER BY `row_number`",
      [batch]);
    assert.equal(staged.length,6);
    assert.ok(staged.every(x=>x.status==="WARNING" && x.imported_entity_id===null));
    const [reference]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT low_value,high_value,approval_status FROM reference_intervals WHERE id=?",[interval]);
    assert.equal(String(reference[0].low_value),"70.000000");
    assert.equal(String(reference[0].approval_status),"APPROVED");
    const [prices]=await reader.execute<mysql.RowDataPacket[]>(
      "SELECT id,unit_price FROM price_list_items WHERE id IN (?,?)",[price,privatePrice]);
    const values=new Map(prices.map(x=>[String(x.id),String(x.unit_price)]));
    assert.equal(values.get(price),"110.1250");
    assert.equal(values.get(privatePrice),"9999.9999");
  } finally {
    await writer.rollback().catch(()=>{});
    await exec("DELETE FROM catalog_import_rows WHERE batch_id=?",[batch]).catch(()=>{});
    await exec("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await exec("DELETE FROM price_list_items WHERE id IN (?,?)",[price,privatePrice]).catch(()=>{});
    await exec("DELETE FROM reference_intervals WHERE id=?",[interval]).catch(()=>{});
    await exec("DELETE FROM price_lists WHERE id IN (?,?)",[list,privateList]).catch(()=>{});
    await exec("DELETE FROM test_components WHERE id=?",[component]).catch(()=>{});
    await exec("DELETE FROM units WHERE id=?",[unit]).catch(()=>{});
    await exec("DELETE FROM lab_tests WHERE id IN (?,?)",[testA,testB]).catch(()=>{});
    await exec("DELETE FROM departments WHERE id IN (?,?)",[deptA,deptB]).catch(()=>{});
    await exec("DELETE FROM branches WHERE id IN (?,?)",[branchA,branchB]).catch(()=>{});
    await exec("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
    await exec("DELETE FROM organizations WHERE id IN (?,?)",[org,other]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
