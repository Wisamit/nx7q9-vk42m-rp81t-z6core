import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/**
 * Durable uniqueness is verified against a real MariaDB migration. A nullable
 * historical key intentionally preserves pre-feature import batch rows.
 */
test("Stage 148 MariaDB: same actor and same source request cannot create two staging batches",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const conn=await mysql.createConnection({
    host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1),
  });
  const orgA=randomUUID(),orgB=randomUUID(),userA=randomUUID(),userB=randomUUID();
  const code=orgA.slice(0,8);
  const key=randomUUID(),otherKey=randomUUID();
  const batches:string[]=[];
  const execute=(sql:string,args:(string|number|null)[])=>conn.execute(sql,args);
  async function insert(org:string,actor:string,source:string,requestKey:string|null,name:string){
    const id=randomUUID();
    await execute("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,submission_key,status,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?, 'DRAFT',?,NOW(3))",
      [id,org,source,name,"a".repeat(64),requestKey,actor]);
    batches.push(id);
    return id;
  }
  try{
    for(const [org,suffix] of [[orgA,"A"],[orgB,"B"]]){
      await execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [org,"S148-"+code+suffix,"Stage 148 synthetic"]);
    }
    for(const [actor,org,suffix] of [[userA,orgA,"A"],[userB,orgA,"B"],[randomUUID(),orgB,"C"]]){
      if(suffix==="C")continue;
      await execute("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [actor,org,"s148-"+code+suffix,"Stage 148 reviewer"]);
    }
    const [usersB] = await conn.query<mysql.RowDataPacket[]>(
      "SELECT id FROM users WHERE organization_id=? ORDER BY id LIMIT 1",[orgB]);
    let userOutside:string;
    if(usersB.length) userOutside=usersB[0].id as string;
    else{
      userOutside=randomUUID();
      await execute("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [userOutside,orgB,"s148-"+code+"C","Stage 148 reviewer"]);
    }
    const first=await insert(orgA,userA,"CSV_REVIEW",key,"canonical.csv");
    await assert.rejects(()=>insert(orgA,userA,"CSV_REVIEW",key,"duplicate.csv"),
      (error:unknown)=>Boolean(error && typeof error==="object" &&
        "code" in error && error.code==="ER_DUP_ENTRY"));
    const second=await insert(orgA,userA,"CSV_REVIEW",otherKey,"new-request.csv");
    const third=await insert(orgA,userB,"CSV_REVIEW",key,"other-reviewer.csv");
    const fourth=await insert(orgA,userA,"CONFIG_BUNDLE_REVIEW",key,"different-source.json");
    const fifth=await insert(orgB,userOutside,"CSV_REVIEW",key,"another-organization.csv");
    const before=await insert(orgA,userA,"CSV_REVIEW",null,"pre-migration-a.csv");
    const after=await insert(orgA,userA,"CSV_REVIEW",null,"pre-migration-b.csv");
    assert.equal(new Set([first,second,third,fourth,fifth,before,after]).size,7);

    const [rows]=await conn.execute<mysql.RowDataPacket[]>(
      "SELECT id,organization_id,created_by_user_id,source_type,source_name,source_checksum,status FROM catalog_import_batches WHERE organization_id=? AND created_by_user_id=? AND source_type=? AND submission_key=?",
      [orgA,userA,"CSV_REVIEW",key]);
    assert.equal(rows.length,1);
    assert.equal(rows[0].id,first);
    assert.equal(rows[0].source_name,"canonical.csv");
  }finally{
    if(batches.length)await execute("DELETE FROM catalog_import_batches WHERE id IN ("+
      batches.map(()=>"?").join(",")+")",batches).catch(()=>{});
    await execute("DELETE FROM users WHERE username LIKE ?",["s148-"+code+"%"]).catch(()=>{});
    await execute("DELETE FROM organizations WHERE id IN (?,?)",[orgA,orgB]).catch(()=>{});
    await conn.end();
  }
});
