import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { normalizeLiveTariffPrice } from "../src/lib/pricing-exact-money.ts";
import { planNextPriceRevision } from "../src/lib/pricing-version-governance.ts";

test("F1 MariaDB: DECIMAL(18,4) tariff revisions persist exact cents, preserve previous history and serialize writes", { timeout: 90000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [db, contender] = await Promise.all([mysql.createConnection(config), mysql.createConnection(config)]);
  const org=randomUUID(),dep=randomUUID(),testId=randomUUID(),pkg=randomUUID();
  const list=randomUUID(),oldId=randomUUID(),newId=randomUUID(),pkgId=randomUUID();
  const suffix=org.slice(0,8);
  const created: Array<{table:string;id:string}> = [];
  async function insert(table:string,id:string,sql:string,params:string[]) {
    await db.execute(sql,params);
    created.unshift({table,id});
  }
  try {
    await insert("organizations",org,
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"F1ORG"+suffix,"Synthetic precision lab"]);
    await insert("departments",dep,
      "INSERT INTO departments(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [dep,org,"F1DEP"+suffix,"Synthetic department"]);
    await insert("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [testId,org,dep,"F1TEST"+suffix,"Synthetic test"]);
    await insert("commercial_packages",pkg,
      "INSERT INTO commercial_packages(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [pkg,org,"F1PKG"+suffix,"Synthetic package"]);
    await insert("price_lists",list,
      "INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,currency,effective_from,updated_at) VALUES(?,?,?,?,'ORGANIZATION','AED',?,NOW(3))",
      [list,org,"F1LIST"+suffix,"Synthetic tariff","2026-01-01"]);
    await insert("price_list_items",oldId,
      "INSERT INTO price_list_items(id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [oldId,list,testId,"10.1200","2026-01-01"]);

    const amount=normalizeLiveTariffPrice("1234567890123.0001");
    const max=normalizeLiveTariffPrice("99999999999999.9999");
    assert.equal(amount,"1234567890123.0001");
    assert.equal(max,"99999999999999.9999");

    await db.beginTransaction();
    await db.execute("SELECT id FROM price_lists WHERE id=? FOR UPDATE",[list]);
    const [oldRows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,effective_from,effective_to FROM price_list_items WHERE price_list_id=? AND test_id=?",
      [list,testId]);
    const current=oldRows.map(x=>({
      id:String(x.id),status:String(x.status) as "ACTIVE" | "INACTIVE",
      effectiveFrom:new Date(x.effective_from),effectiveTo:x.effective_to ? new Date(x.effective_to):null,
    }));
    const effectiveFrom=new Date("2026-06-01T00:00:00.000Z");
    const plan=planNextPriceRevision(current,effectiveFrom);
    assert.equal(plan.ok,true);
    if(!plan.ok)throw Error("Unexpected revision planning failure");
    assert.deepEqual(plan.predecessorIdsToClose,[oldId]);

    // A second transaction must not race past the same price-list lock.
    const attempted=contender.query("SELECT id FROM price_lists WHERE id=? FOR UPDATE",[list]);
    await db.execute(
      "INSERT INTO price_list_items(id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [newId,list,testId,amount,effectiveFrom.toISOString().slice(0,19).replace("T"," ")]);
    created.unshift({table:"price_list_items",id:newId});
    await db.execute("UPDATE price_list_items SET effective_to=? WHERE id=?",
      [plan.predecessorCloseAt.toISOString().slice(0,23).replace("T"," "),oldId]);
    await db.commit();
    const [locked]=await attempted;
    assert.equal((locked as mysql.RowDataPacket[]).length,1);
    const [allVersions]=await contender.execute<mysql.RowDataPacket[]>(
      "SELECT id,unit_price,effective_from,effective_to FROM price_list_items WHERE price_list_id=? ORDER BY effective_from",
      [list]);
    assert.equal(allVersions.length,2);
    assert.equal(String(allVersions[0].unit_price),"10.1200");
    assert.ok(allVersions[0].effective_to);
    assert.equal(String(allVersions[1].unit_price),amount);
    const duplicate=planNextPriceRevision(allVersions.map(row=>({
      id:String(row.id),status:"ACTIVE" as const,
      effectiveFrom:new Date(row.effective_from),
      effectiveTo:row.effective_to ? new Date(row.effective_to):null,
    })),effectiveFrom);
    assert.equal(duplicate.ok,false);

    await insert("price_list_package_items",pkgId,
      "INSERT INTO price_list_package_items(id,price_list_id,package_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [pkgId,list,pkg,max,"2026-06-01"]);
    const [savedPackage]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT unit_price FROM price_list_package_items WHERE id=?",[pkgId]);
    assert.equal(String(savedPackage[0].unit_price),max);

    const [foreign]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM price_list_items WHERE price_list_id<>? AND id IN (?,?)",[list,oldId,newId]);
    assert.equal(foreign.length,0);
  } finally {
    try { await db.rollback(); } catch {}
    try { await contender.rollback(); } catch {}
    for(const row of created){
      await db.execute("DELETE FROM `"+row.table+"` WHERE id=?",[row.id]).catch(()=>undefined);
    }
    await Promise.all([db.end(),contender.end()]);
  }
});
