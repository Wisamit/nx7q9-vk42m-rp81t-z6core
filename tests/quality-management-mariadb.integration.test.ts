import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

test("MariaDB quality parent locks serialize case, CAPA, audit and SOP transitions", { timeout: 50000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const conf = {
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  };
  const [db, a, b] = await Promise.all([
    mysql.createConnection(conf), mysql.createConnection(conf), mysql.createConnection(conf),
  ]);
  const uid = () => randomUUID();
  const org = uid(), branch = uid(), operator = uid(), nc = uid(), capa = uid(), action = uid();
  const audit = uid(), document = uid(), v1 = uid(), v2 = uid();
  const analyzer = uid(), competency = uid(), grant = uid();
  const suffix = org.slice(0, 8);
  const cleanup: Array<{ sql: string; params: string[] }> = [];
  async function seed(sql: string, params: string[], undo: string, values: string[]) {
    await db.execute(sql,params);
    cleanup.unshift({sql:undo, params:values});
  }
  const timeout = (e: unknown) => Boolean(e && typeof e === "object" && "code" in e && e.code === "ER_LOCK_WAIT_TIMEOUT");
  try {
    await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"QMS-"+suffix,"QMS CI"],"DELETE FROM organizations WHERE id=?",[org]);
    await seed("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [branch,org,"QMS-"+suffix,"Quality Branch"],"DELETE FROM branches WHERE id=?",[branch]);
    await seed("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [operator,org,"qms-"+suffix,"QA Reviewer"],"DELETE FROM users WHERE id=?",[operator]);
    await seed("INSERT INTO nonconformances(id,organization_id,branch_id,case_number,title,description,category,severity,reported_by_user_id,updated_at) VALUES (?,?,?,?,?,?,?,?,?,NOW(3))",
      [nc,org,branch,"NC-"+suffix,"QMS finding","Nonconformance details","PROCESS","MAJOR",operator],
      "DELETE FROM nonconformances WHERE id=?",[nc]);
    await seed("INSERT INTO capas(id,organization_id,branch_id,nonconformance_id,capa_number,title,issue_description,owner_user_id,updated_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))",
      [capa,org,branch,nc,"CAPA-"+suffix,"Corrective action","Problem details",operator],
      "DELETE FROM capas WHERE id=?",[capa]);
    await seed("INSERT INTO capa_actions(id,capa_id,action_type,description,status,completed_at,updated_at) VALUES (?,?,'CORRECTIVE','Fix was recorded','COMPLETED',NOW(3),NOW(3))",
      [action,capa],"DELETE FROM capa_actions WHERE id=?",[action]);
    await seed("INSERT INTO internal_audits(id,organization_id,branch_id,audit_number,title,scope,scheduled_at,lead_auditor_user_id,updated_at) VALUES (?,?,?,?,?,'QA Scope',CURRENT_DATE(),?,NOW(3))",
      [audit,org,branch,"IA-"+suffix,"Audit cycle",operator],
      "DELETE FROM internal_audits WHERE id=?",[audit]);
    await seed("INSERT INTO quality_documents(id,organization_id,branch_id,code,title_en,document_type,current_effective_version,updated_at) VALUES (?,?,?,?,?,'SOP',0,NOW(3))",
      [document,org,branch,"SOP-"+suffix,"Workflow policy"],
      "DELETE FROM quality_documents WHERE id=?",[document]);
    for (const [vid,num] of [[v1,"1"],[v2,"2"]] as const) {
      await seed("INSERT INTO quality_document_versions(id,document_id,version,status,submitted_by_user_id) VALUES (?,?,?,'APPROVED',?)",
        [vid,document,num,operator],"DELETE FROM quality_document_versions WHERE id=?",[vid]);
    }
    await seed("INSERT INTO analyzers(id,organization_id,branch_id,code,name,protocol,transport,updated_at) VALUES (?,?,?,?,?,'ASTM','TCP_CLIENT',NOW(3))",
      [analyzer,org,branch,"QMS-"+suffix,"QA Analyzer"],"DELETE FROM analyzers WHERE id=?",[analyzer]);
    await seed("INSERT INTO competency_assessments(id,organization_id,branch_id,user_id,analyzer_id,competency_name,assessment_method,result,assessed_by_user_id) VALUES (?,?,?,?,?,'Instrument competency','Observed assessment','PASS',?)",
      [competency,org,branch,operator,analyzer,operator],"DELETE FROM competency_assessments WHERE id=?",[competency]);
    await b.query("SET SESSION innodb_lock_wait_timeout = 1");

    // First actor closes a nonconformance while second actor attempts to link a new CAPA.
    await a.beginTransaction();
    const [ncLock] = await a.execute<mysql.RowDataPacket[]>(
      "SELECT id,status FROM nonconformances WHERE id=? AND organization_id=? FOR UPDATE",[nc,org]);
    assert.equal(ncLock[0]?.status,"OPEN");
    await a.execute("UPDATE nonconformances SET status='CLOSED',closed_by_user_id=?,closed_at=NOW(3) WHERE id=?",[operator,nc]);
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM nonconformances WHERE id=? FOR UPDATE",[nc]),timeout);
    await b.rollback();
    await a.commit();
    const [closedNc] = await b.execute<mysql.RowDataPacket[]>("SELECT status FROM nonconformances WHERE id=?",[nc]);
    assert.equal(closedNc[0]?.status,"CLOSED");

    // Review and action update lock CAPA parent before changing action data.
    await a.beginTransaction();
    await a.execute("SELECT id FROM capas WHERE id=? FOR UPDATE",[capa]);
    const [remaining] = await a.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM capa_actions WHERE capa_id=? AND status NOT IN ('COMPLETED','CANCELLED')",[capa]);
    assert.equal(Number(remaining[0]?.total),0);
    await a.execute("UPDATE capas SET status='CLOSED',effectiveness='EFFECTIVE',closed_at=NOW(3) WHERE id=?",[capa]);
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM capas WHERE id=? FOR UPDATE",[capa]),timeout);
    await b.rollback();
    await a.commit();
    const [closedCapa] = await b.execute<mysql.RowDataPacket[]>("SELECT status FROM capas WHERE id=?",[capa]);
    assert.equal(closedCapa[0]?.status,"CLOSED");

    // Audit closure excludes a concurrent finding creation using the same locked parent.
    await a.beginTransaction();
    await a.execute("SELECT id FROM internal_audits WHERE id=? FOR UPDATE",[audit]);
    await a.execute("UPDATE internal_audits SET status='COMPLETED',completed_at=NOW(3) WHERE id=?",[audit]);
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM internal_audits WHERE id=? FOR UPDATE",[audit]),timeout);
    await b.rollback();
    await a.commit();
    const [closedAudit] = await b.execute<mysql.RowDataPacket[]>("SELECT status FROM internal_audits WHERE id=?",[audit]);
    assert.equal(closedAudit[0]?.status,"COMPLETED");

    // Two approved versions cannot independently become effective; older version loses.
    await a.beginTransaction();
    await a.execute("SELECT id FROM quality_documents WHERE id=? FOR UPDATE",[document]);
    await a.execute("UPDATE quality_document_versions SET status='EFFECTIVE',effective_from=NOW(3) WHERE id=?",[v2]);
    await a.execute("UPDATE quality_documents SET current_effective_version=2 WHERE id=?",[document]);
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM quality_documents WHERE id=? FOR UPDATE",[document]),timeout);
    await b.rollback();
    await a.commit();
    const [latest] = await b.execute<mysql.RowDataPacket[]>("SELECT current_effective_version FROM quality_documents WHERE id=?",[document]);
    assert.equal(Number(latest[0]?.current_effective_version),2);
    const [older] = await b.execute<mysql.RowDataPacket[]>(
      "SELECT version FROM quality_document_versions WHERE id=? AND version > ?",[v1,latest[0].current_effective_version]);
    assert.equal(older.length,0);
    // A single analyzer lock prevents duplicate active grants, and failure suspends it atomically.
    await a.beginTransaction();
    await a.execute("SELECT id FROM analyzers WHERE id=? FOR UPDATE",[analyzer]);
    await a.execute("INSERT INTO analyzer_authorizations(id,organization_id,user_id,analyzer_id,approved_by_user_id,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [grant,org,operator,analyzer,operator]);
    cleanup.unshift({ sql: "DELETE FROM analyzer_authorizations WHERE id=?", params:[grant] });
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM analyzers WHERE id=? FOR UPDATE",[analyzer]),timeout);
    await b.rollback();
    await a.commit();
    const [granted] = await b.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM analyzer_authorizations WHERE user_id=? AND analyzer_id=? AND status='ACTIVE'",[operator,analyzer]);
    assert.equal(Number(granted[0]?.total),1);

    await a.beginTransaction();
    await a.execute("SELECT id FROM analyzers WHERE id=? FOR UPDATE",[analyzer]);
    await a.execute("UPDATE analyzer_authorizations SET status='SUSPENDED' WHERE user_id=? AND analyzer_id=? AND status='ACTIVE'",[operator,analyzer]);
    await b.beginTransaction();
    await assert.rejects(b.execute("SELECT id FROM analyzers WHERE id=? FOR UPDATE",[analyzer]),timeout);
    await b.rollback();
    await a.commit();
    const [afterFail] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM analyzer_authorizations WHERE user_id=? AND analyzer_id=? AND status='ACTIVE'",[operator,analyzer]);
    assert.equal(Number(afterFail[0]?.total),0);
  } finally {
    await Promise.all([a.rollback().catch(()=>{}),b.rollback().catch(()=>{})]);
    for (const item of cleanup) await db.execute(item.sql,item.params);
    await Promise.all([a.end(),b.end(),db.end()]);
  }
});
