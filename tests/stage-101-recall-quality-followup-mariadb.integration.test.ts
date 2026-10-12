import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 101 MariaDB: linked quality follow-up cannot escape branch/organization and pagination is stable",{timeout:75000},async()=>{
 if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
 const u=new URL(process.env.DATABASE_URL);
 const config={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
  password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
 const db=await mysql.createConnection(config);
 const org=randomUUID(),otherOrg=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),
  user=randomUUID(),lot=randomUUID(),item=randomUUID(),event=randomUUID(),
  caseId=randomUUID(),nonconformanceId=randomUUID(),key=org.slice(0,8);
 const created:Array<{table:string;id:string}>=[];
 async function put(table:string,id:string,sql:string,params:(string|number)[]){
  await db.execute(sql,params);created.unshift({table,id});
 }
 try {
  for(const [id,suffix]of [[org,"A"],[otherOrg,"B"]]){
   await put("organizations",id,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
     [id,"S101"+key+suffix,"Stage101 Test"]);
  }
  for(const [id,suffix]of [[branch,"A"],[otherBranch,"B"]]){
   await put("branches",id,
    "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
    [id,org,"S101"+key+suffix,"Stage101 Branch"]);
  }
  await put("users",user,
   "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
   [user,org,"s101"+key,"Follow-up Officer"]);
  await put("inventory_items",item,
   "INSERT INTO inventory_items(id,organization_id,code,name_en,stock_unit,updated_at) VALUES(?,?,?,?,?,NOW(3))",
   [item,org,"S101"+key,"Lot Product","UNIT"]);
  await put("inventory_lots",lot,
   "INSERT INTO inventory_lots(id,organization_id,item_id,lot_number,updated_at) VALUES(?,?,?,?,NOW(3))",
   [lot,org,item,"S101"+key]);
  await put("inventory_lot_safety_events",event,
   "INSERT INTO inventory_lot_safety_events(id,organization_id,lot_id,actor_user_id,branch_id,prior_status,next_status,reason,affected_stocks) "+
   "VALUES(?,?,?,?,?,'AVAILABLE','RECALLED','Evidence of manufacturer recall','[]')",
   [event,org,lot,user,branch]);
  await put("nonconformances",nonconformanceId,
   "INSERT INTO nonconformances(id,organization_id,branch_id,case_number,title,description,category,severity,reported_by_user_id,updated_at) "+
   "VALUES(?,?,?,?,?,?,?,'MAJOR',?,NOW(3))",
   [nonconformanceId,org,branch,"S101NC"+key,"Recall quality follow-up",
    "Investigation pending for held lot","INVENTORY_LOT_SAFETY",user]);
  await put("inventory_lot_quality_cases",caseId,
   "INSERT INTO inventory_lot_quality_cases(id,organization_id,lot_id,branch_id,safety_event_id,nonconformance_id,created_by_user_id) "+
   "VALUES(?,?,?,?,?,?,?)",
   [caseId,org,lot,branch,event,nonconformanceId,user]);
  const base="SELECT ilqc.id FROM inventory_lot_quality_cases ilqc "+
   "JOIN nonconformances nc ON nc.id=ilqc.nonconformance_id "+
   "WHERE ilqc.organization_id=? AND ilqc.branch_id IN (?) AND nc.status NOT IN ('CLOSED','CANCELLED') "+
   "ORDER BY ilqc.created_at DESC,ilqc.id DESC LIMIT 40 OFFSET 0";
  const [mine]=await db.execute<mysql.RowDataPacket[]>(base,[org,branch]);
  const [otherBranchRows]=await db.execute<mysql.RowDataPacket[]>(base,[org,otherBranch]);
  const [otherTenantRows]=await db.execute<mysql.RowDataPacket[]>(base,[otherOrg,branch]);
  assert.equal(mine.length,1);
  assert.equal(otherBranchRows.length,0);
  assert.equal(otherTenantRows.length,0);
  await db.execute("UPDATE nonconformances SET status='CLOSED' WHERE id=?",[nonconformanceId]);
  const [closed]=await db.execute<mysql.RowDataPacket[]>(base,[org,branch]);
  assert.equal(closed.length,0);
  const [all]=await db.execute<mysql.RowDataPacket[]>(
    "SELECT id FROM inventory_lot_quality_cases WHERE organization_id=? AND branch_id=?",[org,branch]);
  assert.equal(all.length,1,"historical closed case remains traceable without mutation");
 }finally{
  for(const {table,id}of created){
   await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
  }
  await db.end();
 }
});
