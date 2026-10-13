import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 104 real MariaDB: tenant-scoped batch status aggregation and pagination",
  {timeout:75_000},async()=>{
    if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
    const url=new URL(process.env.DATABASE_URL);
    const cfg={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
      password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
    const db=await mysql.createConnection(cfg);
    const org=randomUUID(),other=randomUUID(),branch=randomUUID(),user=randomUUID(),
      batch=randomUUID(),otherBatch=randomUUID(),row1=randomUUID(),row2=randomUUID(),row3=randomUUID();
    const k=org.slice(0,8);
    const cleanup:Array<{table:string;id:string}>=[];
    async function add(table:string,id:string,sql:string,args:unknown[]){
      await db.execute(sql,args);cleanup.unshift({table,id});
    }
    try{
      await add("organizations",org,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [org,"S104A"+k,"Import owner"]);
      await add("organizations",other,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [other,"S104B"+k,"Other tenant"]);
      await add("branches",branch,
        "INSERT INTO branches(id,organization_id,code,name_en,timezone,default_currency,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
        [branch,org,"S104BR"+k,"Import workspace","Asia/Dubai","AED"]);
      await add("users",user,
        "INSERT INTO users(id,organization_id,username,email,password_hash,status,updated_at) VALUES(?,?,?,?,?,'ACTIVE',NOW(3))",
        [user,org,"stage104"+k,"stage104"+k+"@example.test","never-a-login-hash"]);
      await add("catalog_import_batches",batch,
        "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
        [batch,org,"MDB","family-stage-104","VALIDATED",user]);
      await add("catalog_import_batches",otherBatch,
        "INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
        [otherBatch,other,"MDB","foreign-stage-104","VALIDATED",user]);
      const insert="INSERT INTO catalog_import_rows(id,batch_id,row_number,entity_type,status,source_data,updated_at) VALUES(?,?,?,?,?,?,NOW(3))";
      await add("catalog_import_rows",row1,insert,[row1,batch,1,"TEST","IMPORTED","{}"]);
      await add("catalog_import_rows",row2,insert,[row2,batch,2,"REFERENCE_INTERVAL","WARNING","{}"]);
      await add("catalog_import_rows",row3,insert,[row3,batch,3,"PRICE_LIST_ITEM","SKIPPED","{}"]);
      const [visible]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT b.id,COUNT(r.id) AS row_count FROM catalog_import_batches b LEFT JOIN catalog_import_rows r ON r.batch_id=b.id WHERE b.organization_id=? GROUP BY b.id",
        [org]);
      assert.equal(visible.length,1);assert.equal(visible[0].id,batch);assert.equal(Number(visible[0].row_count),3);
      const [wrong]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT b.id FROM catalog_import_batches b WHERE b.organization_id=? AND b.id=?",[org,otherBatch]);
      assert.equal(wrong.length,0);
      const [groups]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT entity_type,status,COUNT(*) AS total FROM catalog_import_rows WHERE batch_id=? GROUP BY entity_type,status",
        [batch]);
      assert.equal(groups.length,3);
      assert.equal(groups.filter(x=>x.status==="WARNING").reduce((sum,x)=>sum+Number(x.total),0),1);
      assert.equal(groups.filter(x=>x.status==="SKIPPED").reduce((sum,x)=>sum+Number(x.total),0),1);
      const [noPrice]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT b.id FROM catalog_import_batches b WHERE b.organization_id=? AND NOT EXISTS (SELECT 1 FROM catalog_import_rows r WHERE r.batch_id=b.id AND r.entity_type IN ('PRICE_LIST','PRICE_LIST_ITEM'))",[org]);
      assert.equal(noPrice.length,0);
      const [ordered]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM catalog_import_batches WHERE organization_id=? ORDER BY created_at DESC,id DESC LIMIT 25",
        [org]);
      assert.equal(ordered.length,1);
    }finally{
      for(const {table,id} of cleanup)await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
      await db.end();
    }
  });
