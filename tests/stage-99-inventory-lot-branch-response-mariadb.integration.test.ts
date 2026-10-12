import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 99 MariaDB: immutable scoped branch acknowledgements and unique per-decision action",{
 timeout:75000,
},async()=>{
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
 const u=new URL(process.env.DATABASE_URL);
 const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
 password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
 const db=await mysql.createConnection(cfg),rival=await mysql.createConnection(cfg);
 const org=randomUUID(),otherOrg=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),
  actor=randomUUID(),item=randomUUID(),lot=randomUUID(),safety=randomUUID(),
  response=randomUUID(),otherResponse=randomUUID(),prefix=org.slice(0,8);
 const created:Array<{table:string;id:string}>=[];
 async function put(table:string,id:string,sql:string,args:(string|number|null)[]){
  await db.execute(sql,args);created.unshift({table,id});
 }
 try{
  for(const [id,tag] of [[org,"A"],[otherOrg,"B"]])await put("organizations",id,
    "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
    [id,"S99"+prefix+tag,"Stage99"]);
  for(const [id,tag] of [[branch,"A"],[otherBranch,"B"]])await put("branches",id,
    "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
    [id,org,"S99"+prefix+tag,"Branch"]);
  await put("users",actor,
    "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
    [actor,org,"s99"+prefix,"Safety staff"]);
  await put("inventory_items",item,
    "INSERT INTO inventory_items(id,organization_id,code,name_en,stock_unit,item_type,updated_at) VALUES(?,?,?,?,?,\'REAGENT\',NOW(3))",
    [item,org,"S99"+prefix,"Reagent","mL"]);
  await put("inventory_lots",lot,
    "INSERT INTO inventory_lots(id,organization_id,item_id,lot_number,safety_status,updated_at) "+
    "VALUES(?,?,?,?,'RECALLED',NOW(3))",[lot,org,item,"S99-LOT-"+prefix]);
  await put("inventory_lot_safety_events",safety,
    "INSERT INTO inventory_lot_safety_events(id,organization_id,lot_id,actor_user_id,branch_id,prior_status,next_status,reason,affected_stocks) "+
    "VALUES(?,?,?,?,?,'QUARANTINED','RECALLED',?,?)",
    [safety,org,lot,actor,branch,"Manufacturer issued an authenticated permanent recall",
      JSON.stringify([])]);
  await put("inventory_lot_branch_responses",response,
    "INSERT INTO inventory_lot_branch_responses(id,organization_id,lot_id,branch_id,safety_event_id,actor_user_id,action,note) "+
    "VALUES(?,?,?,?,?,?,'NOTICE_RECEIVED',?)",
    [response,org,lot,branch,safety,actor,"Received manufacturer recall and escalated internally"]);
  await assert.rejects(db.execute(
    "INSERT INTO inventory_lot_branch_responses(id,organization_id,lot_id,branch_id,safety_event_id,actor_user_id,action,note) "+
    "VALUES(?,?,?,?,?,?,'NOTICE_RECEIVED',?)",
    [randomUUID(),org,lot,branch,safety,actor,"Duplicate action must be refused"]),
    "repeat response for same branch/event/action must fail");
  await put("inventory_lot_branch_responses",otherResponse,
    "INSERT INTO inventory_lot_branch_responses(id,organization_id,lot_id,branch_id,safety_event_id,actor_user_id,action,note) "+
    "VALUES(?,?,?,?,?,?,'ESCALATED_TO_QUALITY',?)",
    [otherResponse,org,lot,otherBranch,safety,actor,"Quality management team contacted in other branch"]);
  const [own]=await db.execute<mysql.RowDataPacket[]>(
    "SELECT id FROM inventory_lot_branch_responses WHERE organization_id=? AND branch_id=? AND safety_event_id=?",
    [org,branch,safety]);
  assert.deepEqual(own.map(x=>x.id),[response]);
  const [forbidden]=await db.execute<mysql.RowDataPacket[]>(
    "SELECT id FROM inventory_lot_branch_responses WHERE organization_id=? AND branch_id=? AND safety_event_id=?",
    [otherOrg,branch,safety]);
  assert.equal(forbidden.length,0);
  await db.beginTransaction();
  await db.execute("SELECT id FROM inventory_lots WHERE id=? FOR UPDATE",[lot]);
  await rival.query("SET innodb_lock_wait_timeout=1");
  await rival.beginTransaction();
  let waiting=false;
  try{await rival.execute("UPDATE inventory_lots SET updated_at=NOW(3) WHERE id=?",[lot]);}
  catch{waiting=true;}
  await rival.rollback();
  assert.equal(waiting,true,"response and recall writer share a lot lock");
  await db.commit();
  const [history]=await db.execute<mysql.RowDataPacket[]>(
    "SELECT reason,next_status FROM inventory_lot_safety_events WHERE id=?",[safety]);
  assert.equal(history[0].next_status,"RECALLED");
  assert.match(history[0].reason,/manufacturer/i);
 }finally{
  await Promise.all([db.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
  for(const c of created)await db.execute("DELETE FROM "+c.table+" WHERE id=?",[c.id]).catch(()=>{});
  await Promise.all([db.end(),rival.end()]);
 }
});
