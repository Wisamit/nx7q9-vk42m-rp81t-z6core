import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 116 MariaDB: complete membership, branch isolation and exact package tariff values",{timeout:90000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const db=await mysql.createConnection(cfg);
  const org=randomUUID(),foreign=randomUUID(),a=randomUUID(),b=randomUUID();
  const da=randomUUID(),dbb=randomUUID(),ta=randomUUID(),tb=randomUUID();
  const pa=randomUUID(),pm=randomUUID(),ka=randomUUID(),km=randomUUID();
  const la=randomUUID(),lb=randomUUID(),lc=randomUUID();
  const priceA=randomUUID(),priceB=randomUUID(),priceClient=randomUUID(),priceMixed=randomUUID();
  const suffix=org.slice(0,8),cleanup:Array<{table:string;column:string;id:string}>=[];
  async function add(table:string,id:string,sql:string,params:(string|number|null)[],column="id"){
    await db.execute(sql,params);
    cleanup.unshift({table,column,id});
  }
  try{
    for(const [id,code]of [[org,"A"],[foreign,"F"]])
      await add("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S116"+suffix+code,"Synthetic Lab"]);
    for(const [id,code]of [[a,"A"],[b,"B"]])
      await add("branches",id,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"S116"+suffix+code,"Synthetic branch"]);
    for(const [id,code,branch]of [[da,"A",a],[dbb,"B",b]])
      await add("departments",id,
        "INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,org,branch,"S116"+suffix+code,"Synthetic department"]);
    for(const [id,code,department]of [[ta,"A",da],[tb,"B",dbb]])
      await add("lab_tests",id,
        "INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,org,department,"S116"+suffix+code,"Synthetic test"]);
    for(const [id,code]of [[pa,"A"],[pm,"M"]])
      await add("test_panels",id,
        "INSERT INTO test_panels(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"S116"+suffix+code,"Synthetic panel"]);
    for(const [id,code]of [[ka,"A"],[km,"M"]])
      await add("commercial_packages",id,
        "INSERT INTO commercial_packages(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"S116"+suffix+code,"Synthetic package"]);
    for(const [panel,tid]of [[pa,ta],[pm,ta],[pm,tb]])
      await add("test_panel_items",panel,
        "INSERT INTO test_panel_items(panel_id,test_id,display_order) VALUES(?,?,0)",
        [panel,tid],"panel_id");
    for(const [pkg,tid]of [[ka,ta],[km,ta],[km,tb]])
      await add("commercial_package_items",pkg,
        "INSERT INTO commercial_package_items(package_id,test_id,display_order) VALUES(?,?,0)",
        [pkg,tid],"package_id");
    for(const [id,c,scope,branch]of [[la,"A","ORGANIZATION",null],
      [lb,"B","BRANCH",b],[lc,"C","CLIENT",null]])
      await add("price_lists",id,
        "INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES(?,?,?,?,?,?,'AED','2025-01-01',NOW(3))",
        [id,org,"S116"+suffix+c,"Synthetic price list",scope,branch]);
    for(const [id,list,pkg,amount]of [[priceA,la,ka,"123.4567"],
      [priceB,lb,ka,"456.7890"],[priceClient,lc,ka,"999.0000"],
      [priceMixed,la,km,"888.0000"]])
      await add("price_list_package_items",id,
        "INSERT INTO price_list_package_items(id,price_list_id,package_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?, '2025-01-01',NOW(3))",
        [id,list,pkg,amount]);

    async function visible(table:string,memberTable:string,memberKey:string,allowed:string[]){
      const marks=allowed.map(()=>"?").join(",");
      const sql="SELECT p.id FROM "+table+" p WHERE p.organization_id=? "+
        "AND EXISTS(SELECT 1 FROM "+memberTable+" m JOIN lab_tests t ON t.id=m.test_id "+
        "JOIN departments d ON d.id=t.department_id WHERE m."+memberKey+"=p.id "+
        "AND t.organization_id=? AND d.status='ACTIVE' AND d.branch_id IN ("+marks+")) "+
        "AND NOT EXISTS(SELECT 1 FROM "+memberTable+" m JOIN lab_tests t ON t.id=m.test_id "+
        "LEFT JOIN departments d ON d.id=t.department_id WHERE m."+memberKey+"=p.id "+
        "AND NOT(t.organization_id=? AND d.status='ACTIVE' AND d.branch_id IN ("+marks+"))) ORDER BY p.id";
      const [rows]=await db.execute<mysql.RowDataPacket[]>(sql,[org,org,...allowed,org,...allowed]);
      return rows.map(x=>x.id as string);
    }
    assert.deepEqual(await visible("test_panels","test_panel_items","panel_id",[a]),[pa]);
    assert.deepEqual(await visible("commercial_packages","commercial_package_items","package_id",[a]),[ka]);
    assert.deepEqual(new Set(await visible("commercial_packages","commercial_package_items","package_id",[a,b])),
      new Set([ka,km]));
    assert.deepEqual(await visible("commercial_packages","commercial_package_items","package_id",[b]),[]);

    const sql="SELECT i.id,i.unit_price AS amount,l.currency FROM price_list_package_items i "+
      "JOIN price_lists l ON l.id=i.price_list_id JOIN commercial_packages p ON p.id=i.package_id "+
      "WHERE l.organization_id=? AND p.organization_id=? AND p.id=? "+
      "AND ((l.scope_type='ORGANIZATION' AND l.branch_id IS NULL) OR "+
      "(l.scope_type='BRANCH' AND l.branch_id=?)) "+
      "AND l.client_id IS NULL AND l.contract_id IS NULL AND l.referrer_id IS NULL AND l.source_id IS NULL ORDER BY i.id";
    const [rows]=await db.execute<mysql.RowDataPacket[]>(sql,[org,org,ka,a]);
    assert.deepEqual(rows.map(x=>x.id),[priceA]);
    assert.equal(String(rows[0].amount),"123.4567");
    assert.equal(rows[0].currency,"AED");
    assert.equal(rows.some(x=>x.id===priceB||x.id===priceClient),false);
  }finally{
    for(const c of cleanup)await db.execute(
      "DELETE FROM "+c.table+" WHERE "+c.column+"=?",[c.id]).catch(()=>{});
    await db.end();
  }
});
