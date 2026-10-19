import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Release closure MariaDB: two send-out writers serialize same order item, retain exact cost and spare other items", {
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const config={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [setup,writer,contender]=await Promise.all([
    mysql.createConnection(config),mysql.createConnection(config),mysql.createConnection(config),
  ]);
  const ids={org:randomUUID(),branch:randomUUID(),user:randomUUID(),patient:randomUUID(),
    test:randomUUID(),order:randomUUID(),a:randomUUID(),b:randomUUID(),
    lab:randomUUID(),referral:randomUUID()};
  const suffix=ids.org.slice(0,8),cleanup:Array<{sql:string;params:string[]}>=[];
  async function put(sql:string,params:string[],undo:string,undoParams:string[]){
    await setup.execute(sql,params);cleanup.unshift({sql:undo,params:undoParams});
  }
  const lock=async(db:typeof writer,id:string)=>{
    const [rows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM order_items WHERE id=? FOR UPDATE",[id]);return rows;
  };
  const current=async(db:typeof writer)=>{
    const [rows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id,cost_amount,cost_currency FROM send_out_referrals "+
      "WHERE organization_id=? AND order_item_id=? AND status NOT IN ('COMPLETED','CANCELLED')",
      [ids.org,ids.a]);return rows;
  };
  try{
    await put("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [ids.org,"CLOSE"+suffix,"Synthetic closure laboratory"],
      "DELETE FROM organizations WHERE id=?",[ids.org]);
    await put("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [ids.branch,ids.org,"CLOSE"+suffix,"Synthetic branch"],
      "DELETE FROM branches WHERE id=?",[ids.branch]);
    await put("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [ids.user,ids.org,"closetest"+suffix,"Synthetic Operator"],
      "DELETE FROM users WHERE id=?",[ids.user]);
    await put("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [ids.patient,ids.org,"CLOSE"+suffix,"Synthetic Patient","synthetic patient"],
      "DELETE FROM patients WHERE id=?",[ids.patient]);
    await put("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [ids.test,ids.org,"CLOSE"+suffix,"Synthetic lab test"],
      "DELETE FROM lab_tests WHERE id=?",[ids.test]);
    await put("INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [ids.order,ids.org,"CLOSE"+suffix,ids.branch,ids.patient,ids.user],
      "DELETE FROM orders WHERE id=?",[ids.order]);
    for (const [id,n] of [[ids.a,"A"],[ids.b,"B"]]) await put(
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
      [id,ids.order,ids.test,"CLOSE"+n,"Synthetic test "+n],
      "DELETE FROM order_items WHERE id=?",[id]);
    await put(
      "INSERT INTO external_laboratories(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [ids.lab,ids.org,"CLOSE"+suffix,"Synthetic external laboratory"],
      "DELETE FROM external_laboratories WHERE id=?",[ids.lab]);
    await contender.query("SET SESSION innodb_lock_wait_timeout=1");

    await writer.beginTransaction();
    assert.equal((await lock(writer,ids.a)).length,1);
    assert.equal((await current(writer)).length,0);
    await contender.beginTransaction();
    assert.equal((await lock(contender,ids.b)).length,1,
      "different order item remains independently writable");
    await contender.rollback();
    await contender.beginTransaction();
    await assert.rejects(()=>lock(contender,ids.a),
      (error:unknown)=>Boolean(error&&typeof error==="object"&&"code" in error&&
        error.code==="ER_LOCK_WAIT_TIMEOUT"),
      "same order item must block second create until first transaction commits");
    await contender.rollback();
    await writer.execute(
      "INSERT INTO send_out_referrals(id,organization_id,branch_id,order_item_id,"+
      "external_laboratory_id,cost_amount,cost_currency,created_by_user_id,updated_at)"+
      " VALUES(?,?,?,?,?,0.1000,'AED',?,NOW(3))",
      [ids.referral,ids.org,ids.branch,ids.a,ids.lab,ids.user]);
    cleanup.unshift({sql:"DELETE FROM send_out_referrals WHERE id=?",params:[ids.referral]});
    await writer.commit();

    await contender.beginTransaction();
    assert.equal((await lock(contender,ids.a)).length,1);
    const rows=await current(contender);
    assert.equal(rows.length,1,"post-lock duplicate lookup sees committed first referral");
    assert.equal(rows[0].id,ids.referral);
    assert.equal(rows[0].cost_amount,"0.1000");
    assert.equal(rows[0].cost_currency,"AED");
    await contender.rollback();
  }finally{
    await writer.rollback().catch(()=>{});
    await contender.rollback().catch(()=>{});
    for(const item of cleanup)await setup.execute(item.sql,item.params).catch(()=>{});
    await Promise.all([setup.end(),writer.end(),contender.end()]);
  }
});
