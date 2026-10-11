import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 80 MariaDB: concurrent dispatchers cannot claim same notification; stale response cannot finalize after reclaim",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const config={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [setup,workerA,workerB]=await Promise.all([
    mysql.createConnection(config),mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),foreignOrg=randomUUID(),deliveryId=randomUUID(),
    notificationId=randomUUID(),foreignNotification=randomUUID(),
    foreignDelivery=randomUUID(),exhaustedDelivery=randomUUID(),futureDelivery=randomUUID();
  const suffix=org.slice(0,8);
  const cleanup:Array<{table:string,id:string}>=[];
  const zero=new Date("2026-10-11T10:00:00.000Z");
  const plus=(minutes:number)=>new Date(zero.getTime()+minutes*60000);
  async function put(table:string,id:string,sql:string,params:(string|number|Date|null)[]){
    await setup.execute(sql,params);
    cleanup.unshift({table,id});
  }
  async function get(id:string){
    const [rows]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT d.status,d.attempt_count,d.max_attempts,d.dispatch_token,d.dispatch_lease_until,d.next_attempt_at "+
      "FROM notification_deliveries d WHERE d.id=?",[id]);
    assert.equal(rows.length,1);
    return rows[0];
  }
  async function claim(db:mysql.Connection,id:string,tenant:string,expectedCount:number,when:Date){
    const token=randomUUID();
    const [changed]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE notification_deliveries d JOIN notifications n ON n.id=d.notification_id "+
      "SET d.attempt_count=d.attempt_count+1,d.dispatch_token=?,d.dispatch_lease_until=? "+
      "WHERE d.id=? AND n.organization_id=? AND d.status IN ('PENDING','FAILED') "+
      "AND d.attempt_count=? AND d.max_attempts>? "+
      "AND (d.next_attempt_at IS NULL OR d.next_attempt_at<=?) "+
      "AND (d.dispatch_lease_until IS NULL OR d.dispatch_lease_until<=?)",
      [token,new Date(when.getTime()+10*60000),id,tenant,expectedCount,expectedCount,when,when]);
    return {success:changed.affectedRows===1,token};
  }
  async function settle(db:mysql.Connection,id:string,token:string,attempt:number){
    const [changed]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE notification_deliveries d JOIN notifications n ON n.id=d.notification_id "+
      "SET d.status='SENT',d.dispatch_token=NULL,d.dispatch_lease_until=NULL,d.next_attempt_at=NULL "+
      "WHERE d.id=? AND n.organization_id=? AND d.dispatch_token=? "+
      "AND d.status='PENDING' AND d.attempt_count=?",
      [id,org,token,attempt]);
    return changed.affectedRows===1;
  }
  try {
    for(const [id,code] of [[org,"A"],[foreignOrg,"F"]]){
      await put("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S80"+suffix+code,"Stage80 Tenant"]);
    }
    for(const [id,tenant] of [[notificationId,org],[foreignNotification,foreignOrg]]){
      await put("notifications",id,
        "INSERT INTO notifications(id,organization_id,event_code,recipient_type,title,body) "+
        "VALUES(?,?,'STAGE_80_TEST','USER','Lease test','Test dispatch')",
        [id,tenant]);
    }
    for(const [id,nid,count,max,next] of [
      [deliveryId,notificationId,0,3,zero],
      [exhaustedDelivery,notificationId,2,2,zero],
      [futureDelivery,notificationId,0,3,plus(20)],
      [foreignDelivery,foreignNotification,0,3,zero],
    ] as Array<[string,string,number,number,Date]>){
      await put("notification_deliveries",id,
        "INSERT INTO notification_deliveries(id,notification_id,channel,destination,status,attempt_count,"+
        "max_attempts,next_attempt_at,updated_at) VALUES(?,?,'EMAIL','recipient@example.invalid',"+
        "'PENDING',?,?,?,NOW(3))",[id,nid,count,max,next]);
    }
    const competing=await Promise.all([
      claim(workerA,deliveryId,org,0,zero),
      claim(workerB,deliveryId,org,0,zero),
    ]);
    assert.equal(competing.filter(x=>x.success).length,1,"exactly one dispatcher obtains the lease");
    const winner=competing.find(x=>x.success)!;
    const after=await get(deliveryId);
    assert.equal(Number(after.attempt_count),1);
    assert.equal(String(after.dispatch_token),winner.token);
    assert.equal((await claim(workerB,deliveryId,org,1,plus(5))).success,false,
      "actively leased notification cannot be re-dispatched");
    assert.equal((await claim(workerB,foreignDelivery,org,0,zero)).success,false,
      "foreign organization cannot claim another tenant's notification");
    assert.equal((await claim(workerB,futureDelivery,org,0,zero)).success,false,
      "future retry must not dispatch early");
    assert.equal((await claim(workerB,exhaustedDelivery,org,2,zero)).success,false,
      "max-attempt budget must be enforced at claim time");

    // Emulate process death by expiring the lease in the isolated test row.
    await setup.execute("UPDATE notification_deliveries SET dispatch_lease_until=? WHERE id=?",
      [plus(9),deliveryId]);
    const recovered=await claim(workerB,deliveryId,org,1,plus(11));
    assert.equal(recovered.success,true,"expired claim can be recovered");
    assert.equal(Number((await get(deliveryId)).attempt_count),2);
    assert.equal(await settle(workerA,deliveryId,winner.token,1),false,
      "stale remote response may not overwrite newer attempt");
    assert.equal(await settle(workerB,deliveryId,recovered.token,2),true);
    assert.equal((await get(deliveryId)).status,"SENT");
    assert.equal((await get(deliveryId)).dispatch_token,null);
    assert.equal((await claim(workerA,deliveryId,org,2,plus(12))).success,false,
      "delivered notification is never attempted again");

    // A worker crash on the last attempt ends in a visible dead letter,
    // rather than silently retrying after max_attempts.
    const [terminal]=await setup.execute<mysql.ResultSetHeader>(
      "UPDATE notification_deliveries SET status='DEAD_LETTER',dispatch_token=NULL,"+
      "dispatch_lease_until=NULL,next_attempt_at=NULL,last_error='notification_retry_budget_exhausted' "+
      "WHERE id=? AND status='PENDING' AND attempt_count=max_attempts",
      [exhaustedDelivery]);
    assert.equal(terminal.affectedRows,1);
    assert.equal((await get(exhaustedDelivery)).status,"DEAD_LETTER");
  }finally{
    for(const row of cleanup){
      await setup.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    }
    await Promise.all([setup.end(),workerA.end(),workerB.end()]);
  }
});
