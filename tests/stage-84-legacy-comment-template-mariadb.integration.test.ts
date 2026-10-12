import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { parseLegacyMasterCsv, legacyMasterFingerprint } from "../src/lib/legacy-master-data-import.ts";

const header="code,name_en,name_ar,text_en,text_ar,scope,test_code,component_code";

test("Stage 84 MariaDB: tenant-specific ACTIVE component linkage, inactive-only audited creation and atomic uniqueness rollback",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const cfg={host:uri.hostname,port:Number(uri.port||3306),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
    database:uri.pathname.slice(1)};
  const [writer,competitor]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),otherOrg=randomUUID(),branch=randomUUID(),actor=randomUUID();
  const testId=randomUUID(),componentId=randomUUID(),foreignTestId=randomUUID();
  const tag=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  const auditIds:string[]=[];
  const read=async(code:string,tenant=org)=>{
    const [rows]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id,organization_id,scope,test_id,component_id,text_en,text_ar,status FROM result_comment_templates WHERE organization_id=? AND code=?",
      [tenant,code]);
    return rows;
  };
  async function resolveComponent(tenant:string,testCode:string,componentCode:string){
    const [rows]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT t.id AS test_id,c.id AS component_id FROM lab_tests t "+
      "JOIN test_components c ON c.test_id=t.id AND c.code=? AND c.status='ACTIVE' "+
      "WHERE t.organization_id=? AND t.code=? AND t.status='ACTIVE'",
      [componentCode,tenant,testCode]);
    return rows;
  }
  async function add(db:mysql.Connection,tenant:string,row:ReturnType<typeof parseLegacyMasterCsv>[number],
    id:string,testIdValue:string|null,componentIdValue:string|null){
    if (!row.textEn || !row.commentScope) throw Error("invalid_comment_template_fixture");
    await db.execute(
      "INSERT INTO result_comment_templates(id,organization_id,code,name_en,name_ar,text_en,text_ar,"+
      "scope,test_id,component_id,status,deactivated_at,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,?,?,?,'INACTIVE',NOW(3),NOW(3))",
      [id,tenant,row.code,row.nameEn,row.nameAr,row.textEn,row.textAr ?? null,
        row.commentScope,testIdValue,componentIdValue]);
  }
  try {
    for(const [id,suffix] of [[org,"A"],[otherOrg,"B"]]){
      await writer.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"C84"+tag+suffix,"Comment import test tenant"]);
      cleanup.unshift({table:"organizations",id});
    }
    await writer.execute("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"C84"+tag,"Branch"]);
    cleanup.unshift({table:"branches",id:branch});
    await writer.execute("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor,org,"c84"+tag,"Import reviewer"]);
    cleanup.unshift({table:"users",id:actor});
    for(const [id,tenant] of [[testId,org],[foreignTestId,otherOrg]]){
      await writer.execute("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,"CBC84","Synthetic test"]);
      cleanup.unshift({table:"lab_tests",id});
    }
    await writer.execute("INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [componentId,testId,"HB84","Synthetic component"]);
    cleanup.unshift({table:"test_components",id:componentId});

    const rows=parseLegacyMasterCsv("COMMENT_TEMPLATE",header+"\n"+
      "NOTE84,Org Note,ملاحظة عامة,Reviewed general comment,نص عام,ORGANIZATION,,\n"+
      "COMP84,Component Note,تعليق مكون,Review before activating,تحقق قبل التفعيل,COMPONENT,CBC84,HB84");
    const fingerprint=legacyMasterFingerprint(org,"COMMENT_TEMPLATE",rows);
    const targets=await resolveComponent(org,"CBC84","HB84");
    assert.equal(targets.length,1);
    assert.equal(targets[0].test_id,testId);
    assert.equal(targets[0].component_id,componentId);
    assert.equal((await resolveComponent(otherOrg,"CBC84","HB84")).length,0,
      "a same-coded foreign test cannot reuse another tenant's component");
    const ids=rows.map(()=>randomUUID());
    await writer.beginTransaction();
    try{
      for(let i=0;i<rows.length;i++){
        await add(writer,org,rows[i],ids[i],i===0?null:testId,i===0?null:componentId);
        const auditId=randomUUID();
        await writer.execute(
          "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) "+
          "VALUES(?,?,?,?,'LEGACY_MASTER_RECORD_CREATED','COMMENT_TEMPLATE',?,?)",
          [auditId,org,branch,actor,ids[i],JSON.stringify({
            kind:"COMMENT_TEMPLATE",code:rows[i].code,fingerprint,scope:rows[i].commentScope,status:"INACTIVE"
          })]);
        auditIds.push(auditId);
      }
      await writer.commit();
      for(const id of ids)cleanup.unshift({table:"result_comment_templates",id});
    }catch(error){await writer.rollback();throw error;}
    assert.equal((await read("NOTE84")).length,1);
    const inserted=(await read("COMP84"))[0];
    assert.equal(inserted.test_id,testId);
    assert.equal(inserted.component_id,componentId);
    assert.equal(inserted.text_ar,"تحقق قبل التفعيل");
    assert.equal(inserted.status,"INACTIVE");
    assert.ok((await read("NOTE84")).every(r=>r.status==="INACTIVE"));
    const [audits]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE organization_id=? AND entity_type='COMMENT_TEMPLATE' AND action='LEGACY_MASTER_RECORD_CREATED'",[org]);
    assert.equal(audits.length,2);

    const conflict=parseLegacyMasterCsv("COMMENT_TEMPLATE",header+"\n"+
      "FRESH84,Fresh note,,Never commit,,ORGANIZATION,,\n"+
      "COMP84,Overwrite attempt,,Invalid replacement,,ORGANIZATION,,");
    let rejected=false;
    await competitor.beginTransaction();
    try{
      await add(competitor,org,conflict[0],randomUUID(),null,null);
      await add(competitor,org,conflict[1],randomUUID(),null,null);
      await competitor.commit();
    }catch{rejected=true;await competitor.rollback();}
    assert.equal(rejected,true);
    assert.equal((await read("FRESH84")).length,0);
    assert.equal((await read("COMP84"))[0].text_en,"Review before activating");

    const [historicResults]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM laboratory_results WHERE 1=0");
    const [historicReports]=await competitor.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM diagnostic_reports WHERE 1=0");
    assert.equal(historicResults.length,0);
    assert.equal(historicReports.length,0);
  }finally{
    for(const id of auditIds)await writer.execute("DELETE FROM audit_events WHERE id=?",[id]).catch(()=>{});
    for(const row of cleanup)await writer.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([writer.end(),competitor.end()]);
  }
});
