import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { overlaps, validPriceDecimal } from "../src/lib/price-import-reconciliation.ts";

test("Stage 126 MariaDB: package draft survives independent claim race and preserves scoped inactive tariff",
  { timeout: 90000 }, async () => {
    if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
    const url = new URL(process.env.DATABASE_URL);
    const cfg = { host: url.hostname, port: Number(url.port || 3306),
      user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
      database: url.pathname.slice(1) };
    const [writer, contender] = await Promise.all([mysql.createConnection(cfg), mysql.createConnection(cfg)]);
    const org = randomUUID(), other = randomUUID(), branch = randomUUID();
    const dep = randomUUID(), foreignDept = randomUUID(), t1 = randomUUID(), t2 = randomUUID();
    const pack = randomUUID(), mixed = randomUUID(), publicList = randomUUID();
    const privateList = randomUUID(), batch = randomUUID(), staged = randomUUID();
    const price = randomUUID(), suffix = org.slice(0, 8);
    const cleanup: Array<{ table: string; id: string; column: string }> = [];
    async function add(table: string, id: string, sql: string, args: Array<string | number | null>, column = "id") {
      await writer.execute(sql, args);
      cleanup.unshift({ table, id, column });
    }
    try {
      for (const [id, tag] of [[org,"A"],[other,"B"]]) {
        await add("organizations", id,
          "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
          [id, "S126PD" + suffix + tag, "Synthetic lab"]);
      }
      await add("branches", branch,
        "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [branch, org, "S126BR" + suffix, "Synthetic branch"]);
      for (const [id, owner, name] of [[dep, org, "A"], [foreignDept, other, "B"]]) {
        await add("departments", id,
          "INSERT INTO departments(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id, owner, "S126DEP" + suffix + name, "Synthetic department"]);
      }
      for (const [id, owner, department, label] of [
        [t1, org, dep, "A"], [t2, other, foreignDept, "B"],
      ]) {
        await add("lab_tests", id,
          "INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) " +
          "VALUES(?,?,?,?,?,NOW(3))",
          [id, owner, department, "S126TEST" + suffix + label, "Synthetic test"]);
      }
      for (const [id, code] of [[pack, "GOOD"], [mixed,"MIXED"]]) {
        await add("commercial_packages", id,
          "INSERT INTO commercial_packages(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id, org, "S126" + suffix + code, "Synthetic package"]);
      }
      for (const [p,t] of [[pack,t1],[mixed,t1],[mixed,t2]]) {
        await add("commercial_package_items", p,
          "INSERT INTO commercial_package_items(package_id,test_id,display_order) VALUES(?,?,1)",
          [p,t], "package_id");
      }
      for (const [id, type] of [[publicList,"ORGANIZATION"],[privateList,"CLIENT"]]) {
        await add("price_lists", id,
          "INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,currency,effective_from,updated_at) " +
          "VALUES(?,?,?,?,?,'AED','2026-01-01',NOW(3))",
          [id,org,"S126LIST"+suffix+type,"Synthetic list",type]);
      }
      await add("catalog_import_batches",batch,
        "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) " +
        "VALUES(?,?, 'LEGACY_MDB_EXPORT','synthetic.mdb','VALIDATED',?,NOW(3))",
        [batch,org,randomUUID()]);
      await add("catalog_import_rows",staged,
        "INSERT INTO catalog_import_rows(id,batch_id,row_number,entity_type,status,source_data,normalized_data,updated_at) " +
        "VALUES(?,?,1,'PRICE_LIST_PACKAGE_ITEM','WARNING','{}',?,NOW(3))",
        [staged,batch,JSON.stringify({
          priceListCode:"S126LIST"+suffix+"ORGANIZATION",
          packageCode:"S126"+suffix+"GOOD",unitPrice:"123.4567",
          effectiveFrom:"2027-02-01",effectiveTo:"",
        })]);
      const visible = "SELECT p.id FROM commercial_packages p WHERE p.organization_id=? AND EXISTS (" +
        "SELECT 1 FROM commercial_package_items i WHERE i.package_id=p.id) AND NOT EXISTS (" +
        "SELECT 1 FROM commercial_package_items i JOIN lab_tests t ON t.id=i.test_id " +
        "WHERE i.package_id=p.id AND (t.organization_id<>? OR t.department_id<>?))";
      const [authorized] = await writer.execute<mysql.RowDataPacket[]>(visible,[org,org,dep]);
      assert.deepEqual(authorized.map(x=>x.id),[pack]);
      assert.equal(validPriceDecimal("123.4567"), true);
      assert.equal(validPriceDecimal("123.45678"), false);
      assert.equal(overlaps("2027-02-01", null,"2027-02-01",null),true);

      await writer.beginTransaction();
      const [lock] = await writer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM catalog_import_rows WHERE id=? FOR UPDATE",[staged]);
      assert.equal(lock.length,1);
      const rivalClaim = contender.execute<mysql.ResultSetHeader>(
        "UPDATE catalog_import_rows SET status='IMPORTED',updated_at=NOW(3) " +
        "WHERE id=? AND status='WARNING' AND imported_entity_id IS NULL",[staged]);
      const [claim] = await writer.execute<mysql.ResultSetHeader>(
        "UPDATE catalog_import_rows SET status='IMPORTED',updated_at=NOW(3) " +
        "WHERE id=? AND status='WARNING' AND imported_entity_id IS NULL",[staged]);
      assert.equal(claim.affectedRows,1);
      await add("price_list_package_items",price,
        "INSERT INTO price_list_package_items(id,price_list_id,package_id,unit_price,effective_from,status,deactivated_at,updated_at) " +
        "VALUES(?,?,?,?,?,'INACTIVE',NOW(3),NOW(3))",
        [price,publicList,pack,"123.4567","2027-02-01"]);
      await writer.execute("UPDATE catalog_import_rows SET imported_entity_id=? WHERE id=?",[price,staged]);
      await writer.commit();
      const [rival] = await rivalClaim;
      assert.equal(rival.affectedRows,0);
      const [saved] = await contender.execute<mysql.RowDataPacket[]>(
        "SELECT p.unit_price,p.status,l.currency,b.organization_id,r.imported_entity_id " +
        "FROM price_list_package_items p JOIN price_lists l ON l.id=p.price_list_id " +
        "JOIN catalog_import_rows r ON r.imported_entity_id=p.id " +
        "JOIN catalog_import_batches b ON b.id=r.batch_id WHERE p.id=?",[price]);
      assert.equal(String(saved[0].unit_price),"123.4567");
      assert.equal(saved[0].status,"INACTIVE");
      assert.equal(saved[0].currency,"AED");
      assert.equal(saved[0].organization_id,org);
      assert.equal(saved[0].imported_entity_id,price);
      const [privateTariffs] = await contender.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM price_list_package_items WHERE price_list_id=?",[privateList]);
      assert.equal(privateTariffs.length,0);
    } finally {
      try { await writer.rollback(); } catch { /* no active transaction */ }
      for (const {table,id,column} of cleanup) {
        await writer.execute("DELETE FROM `"+table+"` WHERE `"+column+"`=?",[id]).catch(()=>undefined);
      }
      await Promise.all([writer.end(),contender.end()]);
    }
  });
