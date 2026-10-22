import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
test("Stage 97 MariaDB: tenant-scoped lot fence, simultaneous quarantine, irreversible recall and immutable history",{
 timeout:75000,
},async()=>{
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
 const u=new URL(process.env.DATABASE_URL);
 const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
  password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
 const [db,other]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
 const org=randomUUID(),otherOrg=randomUUID(),branch=randomUUID(),branch2=randomUUID(),
  user=randomUUID(),reviewer=randomUUID(),item=randomUUID(),lot=randomUUID(),
  stock=randomUUID(),stock2=randomUUID(),audit=randomUUID(),suffix=org.slice(0,8);
 const garbage:Array<{table:string;id:string}>=[];
 async function put(table:string,id:string,sql:string,args:(string|number|null)[]){
  await db.execute(sql,args);garbage.unshift({table,id});
 }
 try{
  for(const [id,tag] of [[org,"A"],[otherOrg,"B"]])
   await put("organizations",id,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,"S97"+suffix+tag,"Stage97 Laboratory"]);
  for(const [id,tag] of [[branch,"A"],[branch2,"B"]])
   await put("branches",id,
    "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
    [id,org,"S97"+suffix+tag,"Stage97 Branch"]);
  for(const [id,tag] of [[user,"A"],[reviewer,"B"]])
   await put("users",id,
    "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
    [id,org,"s97"+suffix+tag,"Safety Reviewer"]);
  await put("inventory_items",item,
   "INSERT INTO inventory_items(id,organization_id,code,name_en,item_type,stock_unit,updated_at) "+
   "VALUES(?,?,?,?,'REAGENT','mL',NOW(3))",
   [item,org,"S97"+suffix,"Stage97 Reagent"]);
  await put("inventory_lots",lot,
   "INSERT INTO inventory_lots(id,organization_id,item_id,lot_number,updated_at) VALUES(?,?,?,?,NOW(3))",
   [lot,org,item,"S97LOT"+suffix]);
  for(const [id,selected,qty] of [[stock,branch,"12.5000"],[stock2,branch2,"7.0000"]])
   await put("inventory_lot_stock",id,
    "INSERT INTO inventory_lot_stock(id,branch_id,lot_id,quantity_on_hand,updated_at) VALUES(?,?,?,?,NOW(3))",
    [id,selected,lot,qty]);
  const [otherRows]=await db.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM inventory_lots WHERE id=? AND organization_id=?",[lot,otherOrg]);
  assert.equal(otherRows.length,0,"cross-organization read must not reveal lots");
  await db.beginTransaction();
  const [hold]=await db.execute<mysql.RowDataPacket[]>(
    "SELECT id,safety_status FROM inventory_lots WHERE id=? AND organization_id=? FOR UPDATE",[lot,org]);
  assert.equal(hold[0].safety_status,"AVAILABLE");
  await other.query("SET innodb_lock_wait_timeout=1");
  await other.beginTransaction();
  let blocked=false;
  try{await other.execute("UPDATE inventory_lots SET safety_status='QUARANTINED' WHERE id=?",[lot]);}
  catch{blocked=true;}
  await other.rollback();
  assert.equal(blocked,true,"writer must serialize behind the safety row lock");
  const [changed]=await db.execute<mysql.ResultSetHeader>(
   "UPDATE inventory_lots SET safety_status='QUARANTINED' "+
   "WHERE id=? AND organization_id=? AND safety_status='AVAILABLE'",[lot,org]);
  assert.equal(changed.affectedRows,1);
  const event1=randomUUID();
  await db.execute("INSERT INTO inventory_lot_safety_events"+
   "(id,organization_id,lot_id,actor_user_id,branch_id,prior_status,next_status,reason,affected_stocks) "+
   "VALUES(?,?,?,?,?,'AVAILABLE','QUARANTINED',?,?)",
   [event1,org,lot,user,branch,"Observed manufacturer lot quality alert",JSON.stringify([
    {branchId:branch,onHand:"12.5000",reserved:"0.0000"},
    {branchId:branch2,onHand:"7.0000",reserved:"0.0000"},
   ])]);
  garbage.unshift({table:"inventory_lot_safety_events",id:event1});
  await db.commit();
  const [held]=await other.execute<mysql.RowDataPacket[]>(
   "SELECT safety_status FROM inventory_lots WHERE id=?",[lot]);
  assert.equal(held[0].safety_status,"QUARANTINED");
  const [stale]=await other.execute<mysql.ResultSetHeader>(
   "UPDATE inventory_lots SET safety_status='AVAILABLE' WHERE id=? AND safety_status='AVAILABLE'",[lot]);
  assert.equal(stale.affectedRows,0);
  const [release]=await db.execute<mysql.ResultSetHeader>(
   "UPDATE inventory_lots SET safety_status='AVAILABLE' "+
   "WHERE id=? AND safety_status='QUARANTINED'",[lot]);
  assert.equal(release.affectedRows,1);
  const event2=randomUUID();
  await db.execute("INSERT INTO inventory_lot_safety_events"+
   "(id,organization_id,lot_id,actor_user_id,branch_id,prior_status,next_status,reason,affected_stocks) "+
   "VALUES(?,?,?,?,?,'QUARANTINED','AVAILABLE',?,?)",
   [event2,org,lot,reviewer,branch2,"Independent investigation approved safe re-use","[]"]);
  garbage.unshift({table:"inventory_lot_safety_events",id:event2});
  const [recall]=await db.execute<mysql.ResultSetHeader>(
   "UPDATE inventory_lots SET safety_status='RECALLED' WHERE id=? AND safety_status='AVAILABLE'",[lot]);
  assert.equal(recall.affectedRows,1);
  const event3=randomUUID();
  await db.execute("INSERT INTO inventory_lot_safety_events"+
   "(id,organization_id,lot_id,actor_user_id,branch_id,prior_status,next_status,reason,affected_stocks) "+
   "VALUES(?,?,?,?,?,'AVAILABLE','RECALLED',?,?)",
   [event3,org,lot,user,branch,"Manufacturer recalled reagent globally","[]"]);
  garbage.unshift({table:"inventory_lot_safety_events",id:event3});
  const [blockedReuse]=await other.execute<mysql.RowDataPacket[]>(
   "SELECT id FROM inventory_lots WHERE id=? AND safety_status='AVAILABLE'",[lot]);
  assert.equal(blockedReuse.length,0);
  const [historical]=await other.execute<mysql.RowDataPacket[]>(
   "SELECT id,prior_status,next_status,reason,actor_user_id FROM inventory_lot_safety_events "+
   "WHERE lot_id=?",[lot]);
  assert.equal(historical.length,3,"prior safety decisions cannot be overwritten");
  // MariaDB events can share created_at to the millisecond. Random UUIDs
  // are identities, not reliable causal sort keys for same-time events.
  const byEventId=new Map(historical.map(row=>[String(row.id),row]));
  assert.equal(byEventId.size,3,"each safety transition is uniquely retained");
  assert.equal(byEventId.get(event1)?.prior_status,"AVAILABLE");
  assert.equal(byEventId.get(event1)?.next_status,"QUARANTINED");
  assert.equal(byEventId.get(event1)?.actor_user_id,user);
  assert.equal(byEventId.get(event2)?.prior_status,"QUARANTINED");
  assert.equal(byEventId.get(event2)?.next_status,"AVAILABLE");
  assert.equal(byEventId.get(event2)?.actor_user_id,reviewer);
  assert.equal(byEventId.get(event3)?.prior_status,"AVAILABLE");
  assert.equal(byEventId.get(event3)?.next_status,"RECALLED");
  assert.equal(byEventId.get(event3)?.actor_user_id,user);
  const [remaining]=await other.execute<mysql.RowDataPacket[]>(
   "SELECT branch_id,quantity_on_hand FROM inventory_lot_stock WHERE lot_id=?",[lot]);
  assert.equal(remaining.length,2);
  assert.equal(remaining.reduce((sum,r)=>sum+Number(r.quantity_on_hand),0),19.5,
   "quarantine must not silently mutate physical stock balances");
  await put("audit_events",audit,
   "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id) "+
   "VALUES(?,?,?,?,'INVENTORY_LOT_RECALLED','InventoryLot',?)",
   [audit,org,branch,user,lot]);
  const [auditRows]=await db.execute<mysql.RowDataPacket[]>(
    "SELECT actor_user_id,branch_id FROM audit_events WHERE id=?",[audit]);
  assert.equal(auditRows[0].actor_user_id,user);
 }finally{
  await Promise.all([db.rollback().catch(()=>{}),other.rollback().catch(()=>{})]);
  for(const {table,id}of garbage)
   await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
  await Promise.all([db.end(),other.end()]);
 }
});
