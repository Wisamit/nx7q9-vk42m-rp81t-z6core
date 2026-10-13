import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 106 MariaDB: cross-tenant queues, inactive branch webhooks and worker locks", { timeout: 80_000 }, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const a = await mysql.createConnection(cfg), b = await mysql.createConnection(cfg);
  const id = () => randomUUID();
  const orgA=id(),orgB=id(),userA=id(),userB=id(),branchActive=id(),branchRetired=id(),
    endpointA=id(),endpointRetired=id(),endpointB=id(),subscriptionA=id(),
    subscriptionRetired=id(),subscriptionB=id(),deliveryA=id(),deliveryRetired=id(),
    deliveryB=id(),notificationA=id(),notificationB=id(),notifDeliveryA=id(),
    notifDeliveryB=id(),audit=id();
  const key = orgA.slice(0,8);
  const cleanup: Array<{table:string;id:string}> = [];
  async function insert(table:string,entityId:string,sql:string,params:Array<string|null>){
    await a.execute(sql,params); cleanup.unshift({table,id:entityId});
  }
  try {
    for (const [org,code] of [[orgA,"A"],[orgB,"B"]]) {
      await insert("organizations",org,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [org,"CR106"+key+code,"Stage106 "+code]);
    }
    for (const [user,org,name] of [[userA,orgA,"A"],[userB,orgB,"B"]]) {
      await insert("users",user,
        "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [user,org,"worker-"+key+name,"Stage 106 operator"]);
    }
    for (const [branch,org,code,status] of [
      [branchActive,orgA,"ACTIVE","ACTIVE"],
      [branchRetired,orgA,"RETIRED","INACTIVE"],
    ]) {
      await insert("branches",branch,
        "INSERT INTO branches(id,organization_id,code,name_en,status,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [branch,org,"CR"+key+code,"Stage106 "+code,status]);
    }
    const endpoints: Array<[string,string,string,string|null]>=[
      [endpointA,orgA,userA,null],
      [endpointRetired,orgA,userA,branchRetired],
      [endpointB,orgB,userB,null],
    ];
    for(const [ep,org,user,branch] of endpoints){
      await insert("integration_endpoints",ep,
        "INSERT INTO integration_endpoints(id,organization_id,branch_id,code,name,endpoint_type,direction,base_url,created_by_user_id,updated_at) VALUES(?,?,?,?,?,'WEBHOOK','OUTBOUND',?,?,NOW(3))",
        [ep,org,branch,"CR106-"+ep.slice(0,8),"Stage 106 outbound","https://example.org/hook",user]);
    }
    for(const [sub,org,ep] of [
      [subscriptionA,orgA,endpointA],
      [subscriptionRetired,orgA,endpointRetired],
      [subscriptionB,orgB,endpointB],
    ]){
      await insert("webhook_subscriptions",sub,
        "INSERT INTO webhook_subscriptions(id,organization_id,endpoint_id,event_type,updated_at) VALUES(?,?,?,?,NOW(3))",
        [sub,org,ep,"report.released"]);
    }
    for(const [delivery,org,sub] of [
      [deliveryA,orgA,subscriptionA],
      [deliveryRetired,orgA,subscriptionRetired],
      [deliveryB,orgB,subscriptionB],
    ]){
      await insert("webhook_deliveries",delivery,
        "INSERT INTO webhook_deliveries(id,organization_id,subscription_id,event_type,payload,payload_hash,status,updated_at) VALUES(?,?,?,'report.released',?,?,'QUEUED',NOW(3))",
        [delivery,org,sub,"{}","a".repeat(64)]);
    }
    for(const [n,org] of [[notificationA,orgA],[notificationB,orgB]]){
      await insert("notifications",n,
        "INSERT INTO notifications(id,organization_id,event_code,recipient_type,title,body) VALUES(?,?,'cron.queued','USER','System test','Synthetic event')",
        [n,org]);
    }
    for(const [d,n] of [[notifDeliveryA,notificationA],[notifDeliveryB,notificationB]]){
      await insert("notification_deliveries",d,
        "INSERT INTO notification_deliveries(id,notification_id,channel,destination,status,updated_at) VALUES(?,?,'EMAIL','test@example.com','PENDING',NOW(3))",
        [d,n]);
    }
    const sql = `SELECT d.id FROM webhook_deliveries d
      INNER JOIN webhook_subscriptions s ON s.id=d.subscription_id
      INNER JOIN integration_endpoints e ON e.id=s.endpoint_id
      LEFT JOIN branches br ON br.id=e.branch_id
      WHERE d.organization_id=? AND s.organization_id=? AND e.organization_id=?
        AND s.status='ACTIVE' AND e.status='ACTIVE'
        AND (e.branch_id IS NULL OR (br.organization_id=? AND br.status='ACTIVE'))
        AND (d.status='QUEUED' OR (d.status='FAILED' AND
          (d.next_attempt_at IS NULL OR d.next_attempt_at<=NOW(3))) OR
          (d.status='SENT' AND d.updated_at<=DATE_SUB(NOW(3),INTERVAL 5 MINUTE)))
      ORDER BY d.created_at ASC LIMIT 15`;
    const [mine]=await a.execute<mysql.RowDataPacket[]>(sql,[orgA,orgA,orgA,orgA]);
    const [other]=await a.execute<mysql.RowDataPacket[]>(sql,[orgB,orgB,orgB,orgB]);
    assert.deepEqual(mine.map(x=>x.id),[deliveryA]);
    assert.deepEqual(other.map(x=>x.id),[deliveryB]);
    const [pendingA]=await a.execute<mysql.RowDataPacket[]>(
      "SELECT d.id FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.organization_id=? AND d.status='PENDING'",
      [orgA]);
    const [pendingB]=await a.execute<mysql.RowDataPacket[]>(
      "SELECT d.id FROM notification_deliveries d JOIN notifications n ON n.id=d.notification_id WHERE n.organization_id=? AND d.status='PENDING'",
      [orgB]);
    assert.deepEqual(pendingA.map(x=>x.id),[notifDeliveryA]);
    assert.deepEqual(pendingB.map(x=>x.id),[notifDeliveryB]);
    await insert("audit_events",audit,
      "INSERT INTO audit_events(id,organization_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?, ?, NULL, 'SCHEDULED_COMMUNICATION_DISPATCH_RUN','ScheduledWorker',?,?)",
      [audit,orgA,orgA,JSON.stringify({mode:"SCHEDULED",operation:"TAT",failedSteps:[]})]);
    const [audited]=await a.execute<mysql.RowDataPacket[]>(
      "SELECT organization_id, actor_user_id FROM audit_events WHERE id=?",[audit]);
    assert.equal(audited[0].organization_id,orgA);
    assert.equal(audited[0].actor_user_id,null);
    await a.beginTransaction();
    await a.execute("SELECT id FROM webhook_deliveries WHERE id=? FOR UPDATE",[deliveryA]);
    await b.execute("SET SESSION innodb_lock_wait_timeout=1");
    await assert.rejects(()=>b.execute("UPDATE webhook_deliveries SET status='SENT' WHERE id=?",[deliveryA]),
      e=>(e as {code?:string}).code==="ER_LOCK_WAIT_TIMEOUT");
    await a.rollback();
    const [stillQueued]=await a.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM webhook_deliveries WHERE id=?",[deliveryA]);
    assert.equal(stillQueued[0].status,"QUEUED");
  } finally {
    await a.rollback().catch(()=>{});
    for (const row of cleanup) {
      await a.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    }
    await b.end();await a.end();
  }
});
