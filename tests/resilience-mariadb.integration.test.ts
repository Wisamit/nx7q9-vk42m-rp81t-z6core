import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB branch continuity and retention mutexes reject competing replay/purge", { timeout: 50000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [db,a,b]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const id=()=>randomUUID();
  const org=id(), branch=id(), operator=id(), node=id(), event=id(), policy=id(), continuity=id();
  const suffix=org.slice(0,8);
  const undo: Array<{query:string;params:string[]}>=[];
  const seed=async(query:string,params:string[],remove:string,values:string[])=>{
    await db.execute(query,params);
    undo.unshift({query:remove,params:values});
  };
  const timeout=(err:unknown)=>Boolean(err&&typeof err==="object"&&"code" in err&&err.code==="ER_LOCK_WAIT_TIMEOUT");
  try {
    await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"RES-"+suffix,"Resilience CI"],"DELETE FROM organizations WHERE id=?",[org]);
    await seed("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [branch,org,"RES-"+suffix,"Resilience branch"],"DELETE FROM branches WHERE id=?",[branch]);
    await seed("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [operator,org,"res-"+suffix,"CI Operator"],"DELETE FROM users WHERE id=?",[operator]);
    await seed("INSERT INTO branch_continuity_policies(id,branch_id,mode,offline_clinical_writes_allowed,updated_by_user_id,updated_at) VALUES (?,?,'BUFFER_NON_CLINICAL',0,?,NOW(3))",
      [continuity,branch,operator],"DELETE FROM branch_continuity_policies WHERE id=?",[continuity]);
    await seed("INSERT INTO edge_nodes(id,organization_id,branch_id,code,name,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
      [node,org,branch,"RES-"+suffix,"CI Edge",operator],"DELETE FROM edge_nodes WHERE id=?",[node]);
    await seed("INSERT INTO retention_policies(id,organization_id,data_class,action,retain_days,enabled,created_by_user_id,updated_at) VALUES (?,?,'USER_SESSIONS','PURGE',30,1,?,NOW(3))",
      [policy,org,operator],"DELETE FROM retention_policies WHERE id=?",[policy]);
    await b.query("SET SESSION innodb_lock_wait_timeout=1");

    // Continuity disable must wait for active intake, or intake must wait
    // for the changed policy, via the same branch FOR UPDATE mutex.
    await a.beginTransaction();
    await a.execute("SELECT id FROM branches WHERE id=? AND organization_id=? FOR UPDATE",[branch,org]);
    await a.execute("UPDATE branch_continuity_policies SET mode='CENTRAL_ONLY' WHERE branch_id=?",[branch]);
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM branches WHERE id=? FOR UPDATE",[branch]),timeout);
    await b.rollback();
    await a.commit();
    const [disabled]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT mode,offline_clinical_writes_allowed FROM branch_continuity_policies WHERE branch_id=?",[branch]);
    assert.equal(disabled[0]?.mode,"CENTRAL_ONLY");
    assert.equal(disabled[0]?.offline_clinical_writes_allowed,0);

    await db.execute("UPDATE branch_continuity_policies SET mode='BUFFER_NON_CLINICAL' WHERE branch_id=?",[branch]);
    // A node lock serializes both concurrent duplicate insertions for an idempotency key.
    const payload=JSON.stringify({stage:"arrival"});
    const hash=createHash("sha256").update(payload).digest("hex");
    await a.beginTransaction();
    await a.execute("SELECT id FROM branches WHERE id=? FOR UPDATE",[branch]);
    await a.execute("SELECT id FROM edge_nodes WHERE id=? FOR UPDATE",[node]);
    await a.execute("INSERT INTO edge_queue_messages(id,organization_id,branch_id,edge_node_id,direction,event_type,idempotency_key,payload,payload_hash,status,attempt_count,received_at,updated_at) VALUES (?,?,?,?,'TO_CENTRAL','EDGE_HEALTH_EVENT','one-message',?,?,'RECEIVED',1,NOW(3),NOW(3))",
      [event,org,branch,node,payload,hash]);
    undo.unshift({query:"DELETE FROM edge_queue_messages WHERE id=?",params:[event]});
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM branches WHERE id=? FOR UPDATE",[branch]),timeout);
    await b.rollback();
    await a.commit();
    const [replayed]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT event_type,payload_hash FROM edge_queue_messages WHERE edge_node_id=? AND direction='TO_CENTRAL' AND idempotency_key='one-message'",[node]);
    assert.equal(replayed.length,1);
    assert.equal(replayed[0].event_type,"EDGE_HEALTH_EVENT");
    assert.equal(replayed[0].payload_hash,hash);
    const [others]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM edge_queue_messages WHERE edge_node_id=? AND direction='TO_CENTRAL' AND idempotency_key='one-message' AND event_type='APPOINTMENT_CHECKIN'",[node]);
    assert.equal(others.length,0);

    // Policy mutation and expired-session purge must serialize on organization.
    await a.beginTransaction();
    await a.execute("SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]);
    await a.execute("UPDATE retention_policies SET action='RETAIN_ONLY',enabled=0 WHERE id=?",[policy]);
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]),timeout);
    await b.rollback();
    await a.commit();
    const [after]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT action,enabled FROM retention_policies WHERE id=?",[policy]);
    assert.equal(after[0]?.action,"RETAIN_ONLY");
    assert.equal(after[0]?.enabled,0);
  } finally {
    await Promise.all([a.rollback().catch(()=>{}),b.rollback().catch(()=>{})]);
    for(const item of undo) await db.execute(item.query,item.params);
    await Promise.all([a.end(),b.end(),db.end()]);
  }
});
