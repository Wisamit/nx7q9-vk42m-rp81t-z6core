import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { spreadsheetReferenceFindings } from "../src/lib/catalog-csv-review-references.ts";

/**
 * Two independent MariaDB sessions prove real isolation of review-only master
 * lookups. No actual patient, clinical release, price posting or policy change.
 */
test("F8 §87 MariaDB: live master references exclude foreign tenant, inactive master and unauthorized branch",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,reader]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),foreign=randomUUID(),branchA=randomUUID(),branchB=randomUUID(),
    departmentB=randomUUID(),testA=randomUUID(),testForeign=randomUUID(),
    testB=randomUUID(),testOff=randomUUID(),unitA=randomUUID(),unitForeign=randomUUID(),
    packageA=randomUUID(),packageForeign=randomUUID(),packageMixed=randomUUID(),priceA=randomUUID(),priceB=randomUUID(),
    priceForeign=randomUUID();
  const tag="F8R"+org.slice(0,8);
  const code=(suffix:string)=>tag+suffix;
  const inserts:Array<{table:string;id:string}>=[];
  async function put(table:string,id:string,sql:string,args:(string|null)[]){
    await writer.execute(sql,args);inserts.unshift({table,id});
  }
  const query=async(sql:string,args:(string|null)[])=>{
    const [rows]=await reader.execute<mysql.RowDataPacket[]>(sql,args);
    return rows;
  };
  try{
    for(const [id,suffix] of [[org,"O"],[foreign,"F"]])
      await put("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,code(suffix),"Synthetic Catalog Isolation"]);
    for(const [id,suffix] of [[branchA,"A"],[branchB,"B"]])
      await put("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,code(suffix),"Synthetic Branch"]);
    await put("departments",departmentB,
      "INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [departmentB,org,branchB,code("DB"),"Other Branch"]);
    for(const [id,tenant,suffix,department,status] of [
      [testA,org,"VISIBLE",null,"ACTIVE"],
      [testForeign,foreign,"FOREIGN",null,"ACTIVE"],
      [testB,org,"UNAUTHORIZED",departmentB,"ACTIVE"],
      [testOff,org,"INACTIVE",null,"INACTIVE"],
    ]) await put("lab_tests",id!,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,department_id,status,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [id,tenant,code(suffix!),"Synthetic Test",department,status]);
    for(const [id,tenant,suffix] of [[unitA,org,"UNIT"],[unitForeign,foreign,"FOREIGNUNIT"]])
      await put("units",id,
        "INSERT INTO units(id,organization_id,code,symbol,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,code(suffix),"u"]);
    for(const [id,tenant,suffix] of [[packageA,org,"PACKAGE"],[packageForeign,foreign,"FOREIGNPACKAGE"],[packageMixed,org,"MIXED"]])
      await put("commercial_packages",id,
        "INSERT INTO commercial_packages(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,code(suffix),"Synthetic Package"]);
    for(const [packageId,testId] of [[packageA,testA],[packageMixed,testA],[packageMixed,testB]])
      await writer.execute("INSERT INTO commercial_package_items(package_id,test_id) VALUES(?,?)",[packageId,testId]);
    for(const [id,tenant,suffix,scope,branch] of [
      [priceA,org,"PRICE","ORGANIZATION",null],
      [priceB,org,"PRICEB","BRANCH",branchB],
      [priceForeign,foreign,"FOREIGNPRICE","ORGANIZATION",null],
    ])await put("price_lists",id!,
      "INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) "+
      "VALUES(?,?,?,?,?,?,'AED','2026-01-01',NOW(3))",
      [id,tenant,code(suffix!),"Synthetic Price",scope,branch]);
    // Do not include branchB: authenticated operator holds only branchA.
    const [tests,units,packages,priceLists]=await Promise.all([
      query("SELECT t.code FROM lab_tests t LEFT JOIN departments d ON d.id=t.department_id "+
        "WHERE t.organization_id=? AND t.status='ACTIVE' "+
        "AND (t.department_id IS NULL OR (d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?)))",
        [org,branchA]),
      query("SELECT code FROM units WHERE organization_id=? AND status='ACTIVE'",[org]),
      query("SELECT p.code FROM commercial_packages p WHERE p.organization_id=? AND p.status='ACTIVE' "+
        "AND EXISTS(SELECT 1 FROM commercial_package_items i JOIN lab_tests t ON t.id=i.test_id "+
        "LEFT JOIN departments d ON d.id=t.department_id WHERE i.package_id=p.id AND "+
        "t.organization_id=? AND t.status='ACTIVE' AND "+
        "(t.department_id IS NULL OR (d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?)))) "+
        "AND NOT EXISTS(SELECT 1 FROM commercial_package_items i JOIN lab_tests t ON t.id=i.test_id "+
        "LEFT JOIN departments d ON d.id=t.department_id WHERE i.package_id=p.id AND NOT ("+
        "t.organization_id=? AND t.status='ACTIVE' AND "+
        "(t.department_id IS NULL OR (d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?)))))",
        [org,org,branchA,org,branchA]),
      query("SELECT code FROM price_lists WHERE organization_id=? AND status='ACTIVE' "+
        "AND source_id IS NULL AND referrer_id IS NULL AND client_id IS NULL AND contract_id IS NULL "+
        "AND ((scope_type='ORGANIZATION' AND branch_id IS NULL) OR (scope_type='BRANCH' AND branch_id=?))",
        [org,branchA]),
    ]);
    const snapshot={
      tests:new Set(tests.map(x=>String(x.code))),
      units:new Set(units.map(x=>String(x.code))),
      packages:new Set(packages.map(x=>String(x.code))),
      priceLists:new Set(priceLists.map(x=>String(x.code))),
    };
    assert.deepEqual([...snapshot.tests],[code("VISIBLE")]);
    assert.deepEqual([...snapshot.units],[code("UNIT")]);
    assert.deepEqual([...snapshot.packages],[code("PACKAGE")]);
    assert.deepEqual([...snapshot.priceLists],[code("PRICE")]);

    const entries=[
      {entityType:"COMPONENT",normalized:{testCode:code("VISIBLE"),unitCode:code("UNIT")},status:"WARNING" as const},
      {entityType:"COMPONENT",normalized:{testCode:code("FOREIGN"),unitCode:code("FOREIGNUNIT")},status:"WARNING" as const},
      {entityType:"PANEL",normalized:{memberTestCodes:[code("UNAUTHORIZED"),code("INACTIVE")]},status:"WARNING" as const},
      {entityType:"PRICE_LIST_ITEM",normalized:{priceListCode:code("PRICEB"),testCode:code("VISIBLE")},status:"WARNING" as const},
      {entityType:"PRICE_LIST_PACKAGE_ITEM",normalized:{priceListCode:code("PRICE"),packageCode:code("FOREIGNPACKAGE")},status:"WARNING" as const},
      {entityType:"PRICE_LIST_PACKAGE_ITEM",normalized:{priceListCode:code("PRICE"),packageCode:code("MIXED")},status:"WARNING" as const},
    ];
    const results=spreadsheetReferenceFindings(entries,snapshot);
    assert.deepEqual(results[0],[]);
    for(const issues of results.slice(1)){
      assert.deepEqual(issues.map(x=>x.code),["CSV_REVIEW_REFERENCE_MISSING_OR_OUT_OF_SCOPE"]);
      assert.ok(!issues[0].message.includes(code("FOREIGN")),"no foreign master code leaked");
    }
    const [stored]=await query("SELECT COUNT(*) AS n FROM catalog_import_batches WHERE organization_id=?",[org]);
    assert.equal(Number(stored[0].n),0,"no clinical, financial or catalog import performed by preflight");
  }finally{
    await writer.execute("DELETE FROM commercial_package_items WHERE package_id IN (?,?)",[packageA,packageMixed]).catch(()=>{});
    for(const row of inserts)await writer.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([writer.end(),reader.end()]);
  }
});
