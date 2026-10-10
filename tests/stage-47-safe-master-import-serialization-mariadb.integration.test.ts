import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {registerSafeMasterUnitAlias,resolveSafeMasterUnitAlias} from "../src/lib/catalog-safe-master-units.ts";

test("Stage 47 MariaDB: two independent batches serialize organization unit identities and re-read rows",
 {timeout:45000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [first,second]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),actor=randomUUID(),b1=randomUUID(),b2=randomUUID(),row=randomUUID(),unit=randomUUID();
  const code="S47"+org.slice(0,8);
  let secondClaimed=false;
  try{
    await first.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,code,"Stage 47 Organization"]);
    await first.execute("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor,org,code,"Stage 47 Actor"]);
    for(const id of [b1,b2])await first.execute(
      "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES(?,?,'LEGACY_MDB_EXPORT','stage47','VALIDATED',?,NOW(3))",
      [id,org,actor]);
    const source=JSON.stringify({code:code+"U",symbol:"mmol/L"});
    await first.execute("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES(?,?,1,'UNIT','VALID',?,?,NOW(3))",
      [row,b2,source,source]);

    await first.beginTransaction();
    const [lock1]=await first.execute<mysql.RowDataPacket[]>("SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]);
    assert.equal(lock1.length,1);
    await second.beginTransaction();
    // Lock attempt is started BEFORE the first transaction commits.
    const acquiring=second.execute<mysql.RowDataPacket[]>("SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]);
    const [current]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,normalized_data FROM catalog_import_rows WHERE batch_id=?",[b2]);
    assert.equal(current.length,1);
    const [newBatch]=await first.execute<mysql.ResultSetHeader>(
      "UPDATE catalog_import_batches SET status='IMPORTED',imported_at=NOW(3) WHERE id=? AND organization_id=? AND status='VALIDATED'",
      [b1,org]);
    assert.equal(newBatch.affectedRows,1);
    await first.execute("INSERT INTO units(id,organization_id,code,symbol,updated_at) VALUES(?,?,?,?,NOW(3))",
      [unit,org,code+"U","mmol/L"]);
    await first.execute("UPDATE catalog_import_rows SET status='SKIPPED' WHERE id=?",[row]);
    await first.commit();

    const [lock2]=await acquiring;
    secondClaimed=true;
    assert.equal(lock2.length,1);
    const [latestRows]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,normalized_data FROM catalog_import_rows WHERE batch_id=?",[b2]);
    assert.equal(latestRows.length,1);
    assert.equal(latestRows[0].status,"SKIPPED",
      "second session must see the committed status and cannot use stale VALID snapshot");
    const [dbUnits]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,symbol FROM units WHERE organization_id=?",[org]);
    assert.equal(dbUnits.length,1);
    const aliases=new Map<string,string|null>();
    for(const r of dbUnits){
      registerSafeMasterUnitAlias(aliases,String(r.code),String(r.id));
      registerSafeMasterUnitAlias(aliases,String(r.symbol),String(r.id));
    }
    assert.deepEqual(resolveSafeMasterUnitAlias(aliases,"mmol/L"),{ok:true,unitId:unit});
    assert.equal(latestRows.filter(r=>r.status==="VALID").length,0);
    await second.commit();
    const [foreign]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM catalog_import_batches WHERE id=? AND organization_id=?",[b1,randomUUID()]);
    assert.equal(foreign.length,0);
  }finally{
    await first.rollback().catch(()=>{});
    if(secondClaimed)await second.rollback().catch(()=>{});
    await first.execute("DELETE FROM catalog_import_rows WHERE id=?",[row]).catch(()=>{});
    await first.execute("DELETE FROM catalog_import_batches WHERE id IN (?,?)",[b1,b2]).catch(()=>{});
    await first.execute("DELETE FROM units WHERE id=?",[unit]).catch(()=>{});
    await first.execute("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
    await first.execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([first.end(),second.end()]);
  }
});
