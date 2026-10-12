import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
test("Stage 100 MariaDB: unique branch/event quality case FK, tenant isolation, immutable event and concurrency lock",{
 timeout:75000,
},async()=>{
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
 const u=new URL(process.env.DATABASE_URL);
 const cfg={host:u.hostname,port:Number(u.port||3306),
  user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
 const [db,rival]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
 const org=randomUUID(),otherOrg=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),
  actor=randomUUID(),item=randomUUID(),lot=randomUUID(),event=randomUUID(),response=randomUUID(),
  nc=randomUUID(),link=randomUUID(),audit=randomUUID(),prefix=org.slice(0,8);
 const created:Array<{table:string;id:string}>=[];
 async function put(table:string,id:string,sql:string,args:(string|number|null)[]){
  await db.execute(sql,args);created.unshift({table,id});
 }
 try{
  for(const [id,tag]of[[org,"A"],[otherOrg,"B"]])await put("organizations",id,
   "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
   [id,"S100"+prefix+tag,"Stage100 Lab"]);
  for(const [id,tag]of[[branch,"A"],[otherBranch,"B"]])await put("branches",id,
   "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
   [id,org,"S100"+prefix+tag,"Stage100 Branch"]);
  await put("users",actor,
   "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
   [actor,org,"s100"+prefix,"Quality officer"]);
  await put("inventory_items",item,
   "INSERT INTO inventory_items(id,organization_id,code,name_en,stock_unit,item_type,updated_at) "+
   "VALUES(?,?,?,?,?,'REAGENT',NOW(3))",[item,org,"S100"+prefix,"Reagent","mL"]);
  await put("inventory_lots",lot,
   "INSERT INTO inventory_lots(id,organization_id,item_id,lot_number,safety_status,updated_at) "+
   "VALUES(?,?,?,?,'RECALLED',NOW(3))",[lot,org,item,"S100-LOT-"+prefix]);
  await put("inventory_lot_safety_events",event,
   "INSERT INTO inventory_lot_safety_events(id,organization_id,lot_id,actor_user_id,branch_id,prior_status,next_status,reason,affected_stocks) "+
   "VALUES(?,?,?,?,?,'QUARANTINED','RECALLED',?,?)",
   [event,org,lot,actor,branch,"Authenticated lot recall event",JSON.stringify([])]);
  await put("inventory_lot_branch_responses",response,
   "INSERT INTO inventory_lot_branch_responses(id,organization_id,lot_id,branch_id,safety_event_id,actor_user_id,action,note) "+
   "VALUES(?,?,?,?,?,?,'ESCALATED_TO_QUALITY',?)",
   [response,org,lot,branch,event,actor,"The quality office must investigate the returned stock"]);
  await put("nonconformances",nc,
   "INSERT INTO nonconformances(id,organization_id,branch_id,case_number,title,description,category,severity,reported_by_user_id) "+
   "VALUES(?,?,?,?,?,?,?,'MAJOR',?,NOW(3))",
   [nc,org,branch,"S100NC-"+prefix,"Manufacturer lot recall investigation",
    "Documented evidence and separate clinical impact review", "INVENTORY_LOT_SAFETY",actor]);
  await put("inventory_lot_quality_cases",link,
   "INSERT INTO inventory_lot_quality_cases(id,organization_id,lot_id,branch_id,safety_event_id,nonconformance_id,created_by_user_id) "+
   "VALUES(?,?,?,?,?,?,?)",[link,org,lot,branch,event,nc,actor]);
  const [own]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM inventory_lot_quality_cases WHERE organization_id=? AND branch_id=? AND safety_event_id=?",
   [org,branch,event]);
  assert.equal(own.length,1);
  const [foreign]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM inventory_lot_quality_cases WHERE organization_id=? AND branch_id=? AND safety_event_id=?",
   [otherOrg,branch,event]);
  assert.equal(foreign.length,0);
  await assert.rejects(db.execute(
   "INSERT INTO inventory_lot_quality_cases(id,organization_id,lot_id,branch_id,safety_event_id,nonconformance_id,created_by_user_id) "+
   "VALUES(?,?,?,?,?,?,?)",[randomUUID(),org,lot,branch,event,randomUUID(),actor]),
   "the same branch and recall decision cannot create a second quality linkage");
  await assert.rejects(db.execute(
   "INSERT INTO inventory_lot_quality_cases(id,organization_id,lot_id,branch_id,safety_event_id,nonconformance_id,created_by_user_id) "+
   "VALUES(?,?,?,?,?,?,?)",[randomUUID(),org,lot,otherBranch,event,nc,actor]),
   "one NC case cannot be linked to two different branches");
  await db.beginTransaction();
  const [locked]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM inventory_lots WHERE id=? FOR UPDATE",[lot]);
  assert.equal(locked.length,1);
  await rival.query("SET innodb_lock_wait_timeout=1");
  await rival.beginTransaction();
  let blocked=false;
  try{await rival.execute("UPDATE inventory_lots SET updated_at=NOW(3) WHERE id=?",[lot]);}
  catch{blocked=true;}
  await rival.rollback();
  assert.equal(blocked,true,"quality writer and recall writer must use the same lot-row serialization");
  await put("audit_events",audit,
   "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id) "+
   "VALUES(?,?,?,?,'INVENTORY_RECALL_QUALITY_CASE_OPENED','Nonconformance',?)",
   [audit,org,branch,actor,nc]);
  await db.commit();
  const [history]=await rival.execute<mysql.RowDataPacket[]>(
   "SELECT e.next_status, n.status FROM inventory_lot_safety_events e "+
   "JOIN inventory_lot_quality_cases l ON l.safety_event_id=e.id "+
   "JOIN nonconformances n ON n.id=l.nonconformance_id WHERE l.id=?",[link]);
  assert.equal(history[0].next_status,"RECALLED");
  assert.equal(history[0].status,"OPEN");
 }finally{
  await Promise.all([db.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
  for(const {table,id}of created)await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
  await Promise.all([db.end(),rival.end()]);
 }
});
