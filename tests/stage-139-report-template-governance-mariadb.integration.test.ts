import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  reportTemplateApprovalError, reportTemplateActivationError, type ReportTemplateTransition,
} from "../src/lib/report-template-governance.ts";

test("Stage 139 MariaDB: tenant isolation, independently approved CAS, two-connection template lock and immutable effective history",{
  timeout: 90000,
},async()=>{
  if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const config={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1),timezone:"Z"};
  const [writer,competitor]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),
    author=randomUUID(),reviewer=randomUUID(),template=randomUUID(),
    previous=randomUUID(),draft=randomUUID(),suffix=org.slice(0,8);
  const created:Array<{table:string;id:string}>=[],audits:string[]=[];
  async function put(table:string,id:string,sql:string,values:(string|number|null)[]){
    await writer.execute(sql,values);
    created.unshift({table,id});
  }
  const before=new Date(Date.now()-3600_000);
  const originalAsOf=new Date(before.getTime()+1000);
  const json=JSON.stringify({languageMode:"BILINGUAL",columns:["TEST","RESULT","REFERENCE"],showSignature:true,showQr:true});
  try {
    for(const [id,tag] of [[org,"A"],[foreignOrg,"F"]])
      await put("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S139"+suffix+tag,"Stage 139 Synthetic Lab"]);
    await put("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S139"+suffix,"Stage 139 Branch"]);
    for(const [id,tag] of [[author,"A"],[reviewer,"R"]])
      await put("users",id,
        "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"s139"+suffix+tag,"Template Governance Staff"]);
    await put("report_templates",template,
      "INSERT INTO report_templates(id,organization_id,branch_id,code,name_en,is_default,created_by_user_id,updated_at) "+
      "VALUES(?,?,?,?,?,1,?,NOW(3))",
      [template,org,branch,"S139"+suffix,"Synthetic template",author]);
    await put("report_template_versions",previous,
      "INSERT INTO report_template_versions(id,template_id,version,status,configuration,change_summary,submitted_by_user_id,approved_by_user_id,approved_at,effective_from) "+
      "VALUES(?, ?,1,'EFFECTIVE',?,?,?,?,?,?)",
      [previous,template,json,"Original approved layout",author,reviewer,
        before.toISOString().slice(0,23).replace("T"," "), before.toISOString().slice(0,23).replace("T"," ")]);
    await put("report_template_versions",draft,
      "INSERT INTO report_template_versions(id,template_id,version,status,configuration,change_summary,submitted_by_user_id) "+
      "VALUES(?, ?,2,'DRAFT',?,?,?)",
      [draft,template,json,"Revised report layout",author]);
    const [foreign]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM report_templates WHERE id=? AND organization_id=?",[template,foreignOrg]);
    assert.equal(foreign.length,0,"foreign tenant cannot claim a template");
    const draftTransition:ReportTemplateTransition={status:"DRAFT",submittedByUserId:author,
      approvedByUserId:null,approvedAt:null,effectiveFrom:null,effectiveTo:null,retiredAt:null};
    assert.equal(reportTemplateApprovalError(draftTransition,author),"template_self_approval_forbidden");
    assert.equal(reportTemplateApprovalError(draftTransition,reviewer),null);
    assert.equal(reportTemplateActivationError(draftTransition,reviewer),"template_version_not_approved");

    await writer.beginTransaction();
    const [locked]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM report_templates WHERE id=? AND organization_id=? AND status='ACTIVE' FOR UPDATE",
      [template,org]);
    assert.equal(locked.length,1);
    await competitor.query("SET innodb_lock_wait_timeout=1");
    await competitor.beginTransaction();
    let refused=false;
    try{
      await competitor.execute("SELECT id FROM report_templates WHERE id=? AND organization_id=? FOR UPDATE",
        [template,org]);
    }catch{ refused=true; }
    await competitor.rollback();
    assert.equal(refused,true,"competing activation cannot interleave through the template lock");

    const [approved]=await writer.execute<mysql.ResultSetHeader>(
      "UPDATE report_template_versions SET status='APPROVED', approved_by_user_id=?,approved_at=NOW(3) "+
      "WHERE id=? AND template_id=? AND status='DRAFT' AND submitted_by_user_id<>? AND approved_by_user_id IS NULL",
      [reviewer,draft,template,reviewer]);
    assert.equal(approved.affectedRows,1);
    const [cannotReplay]=await writer.execute<mysql.ResultSetHeader>(
      "UPDATE report_template_versions SET status='APPROVED' WHERE id=? AND status='DRAFT'",[draft]);
    assert.equal(cannotReplay.affectedRows,0,"approval is single-use CAS");

    const activatedAt=new Date();
    const [retired]=await writer.execute<mysql.ResultSetHeader>(
      "UPDATE report_template_versions SET status='RETIRED',effective_to=?,retired_at=? "+
      "WHERE id=? AND template_id=? AND status='EFFECTIVE' AND effective_from<? AND effective_to IS NULL",
      [activatedAt,activatedAt,previous,template,activatedAt]);
    assert.equal(retired.affectedRows,1);
    const [activated]=await writer.execute<mysql.ResultSetHeader>(
      "UPDATE report_template_versions SET status='EFFECTIVE',effective_from=? "+
      "WHERE id=? AND template_id=? AND status='APPROVED' AND effective_from IS NULL AND approved_by_user_id=?",
      [activatedAt,draft,template,reviewer]);
    assert.equal(activated.affectedRows,1);
    const [activationReplay]=await writer.execute<mysql.ResultSetHeader>(
      "UPDATE report_template_versions SET status='EFFECTIVE' WHERE id=? AND status='APPROVED'",[draft]);
    assert.equal(activationReplay.affectedRows,0);
    const audit=randomUUID();
    audits.push(audit);
    await writer.execute(
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) "+
      "VALUES(?,?,?,?,'REPORT_TEMPLATE_VERSION_ACTIVATED','ReportTemplateVersion',?,?)",
      [audit,org,branch,reviewer,draft,JSON.stringify({approvedByUserId:reviewer,previousVersionId:previous})]);
    await writer.commit();

    const current=async (time:Date)=>{
      const [rows]=await writer.execute<mysql.RowDataPacket[]>(
        "SELECT id,status,version FROM report_template_versions "+
        "WHERE template_id=? AND status IN ('EFFECTIVE','RETIRED') "+
        "AND effective_from<=? AND (effective_to IS NULL OR effective_to>?)",
        [template,time,time]);
      return rows;
    };
    assert.deepEqual((await current(originalAsOf)).map(x=>x.id),[previous],
      "historical as-of reads must retain retired template version");
    assert.deepEqual((await current(new Date(activatedAt.getTime()+1000))).map(x=>x.id),[draft],
      "current as-of reads select only newly activated version");
    const [hist]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT status,effective_from,effective_to FROM report_template_versions WHERE id=?",[previous]);
    assert.equal(hist[0].status,"RETIRED");
    assert.equal(new Date(hist[0].effective_from).getTime(),before.getTime());
    assert.equal(new Date(hist[0].effective_to).getTime(),activatedAt.getTime());
    const [audited]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT action FROM audit_events WHERE id=? AND organization_id=?",[audit,org]);
    assert.equal(audited[0].action,"REPORT_TEMPLATE_VERSION_ACTIVATED");
  } finally {
    await writer.rollback().catch(()=>{});
    await competitor.rollback().catch(()=>{});
    for(const id of audits) await writer.execute("DELETE FROM audit_events WHERE id=?",[id]).catch(()=>{});
    for(const row of created) await writer.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([writer.end(),competitor.end()]);
  }
});
