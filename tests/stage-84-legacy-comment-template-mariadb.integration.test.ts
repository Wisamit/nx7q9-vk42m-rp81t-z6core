import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { prisma } from "../src/lib/db.ts";
import { parseLegacyMasterCsv, legacyMasterFingerprint } from "../src/lib/legacy-master-data-import.ts";
import { resolveLegacyCommentTargets } from "../src/lib/legacy-comment-targets.ts";
import { createLegacyMasterRecords } from "../src/lib/legacy-master-import-commit.ts";

const header="code,name_en,name_ar,text_en,text_ar,scope,test_code,component_code";
test("Stage 84 MariaDB: clinical comment import resolves tenant targets, commits inactive-only with audit, rolls back mixed duplicate batch",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const cfg={host:uri.hostname,port:Number(uri.port||3306),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
    database:uri.pathname.slice(1)};
  const [writer,second]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
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
    const records=rows.map(row=>({...row,id:randomUUID()}));
    assert.deepEqual(await resolveLegacyCommentTargets(prisma,org,rows),
      [{testId:null,componentId:null},{testId,componentId}]);

    await prisma.$transaction(async tx=>{
      await createLegacyMasterRecords(tx,"COMMENT_TEMPLATE",org,records);
      for(const row of records){
        const auditId=randomUUID(); auditIds.push(auditId);
        await tx.auditEvent.create({data:{
          id:auditId,organizationId:org,branchId:branch,actorUserId:actor,
          action:"LEGACY_MASTER_RECORD_CREATED",entityType:"COMMENT_TEMPLATE",
          entityId:row.id,newValues:{importKind:"COMMENT_TEMPLATE",fingerprint,status:"INACTIVE"},
        }});
      }
    },{isolationLevel:"Serializable"});
    for(const item of records)cleanup.unshift({table:"result_comment_templates",id:item.id});

    assert.equal((await read("NOTE84")).length,1);
    const inserted=(await read("COMP84"))[0];
    assert.equal(inserted.test_id,testId);
    assert.equal(inserted.component_id,componentId);
    assert.equal(inserted.text_ar,"تحقق قبل التفعيل");
    assert.equal(inserted.status,"INACTIVE");
    assert.ok((await read("NOTE84")).every(r=>r.status==="INACTIVE"));
    const [audits]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM audit_events WHERE organization_id=? AND entity_type='COMMENT_TEMPLATE' AND action='LEGACY_MASTER_RECORD_CREATED'",[org]);
    assert.equal(audits.length,2);

    // The same test code in another tenant does not grant access to this
    // tenant's component. Organization + active ownership is checked together.
    await assert.rejects(resolveLegacyCommentTargets(prisma,otherOrg,[rows[1]]),
      /comment_component_missing_or_inactive_row_3/);
    // A duplicate in a later row makes the whole transaction roll back.
    const conflict=parseLegacyMasterCsv("COMMENT_TEMPLATE",header+"\n"+
      "FRESH84,Fresh note,,Never commit,,ORGANIZATION,,\n"+
      "COMP84,Overwrite attempt,,Invalid replacement,,ORGANIZATION,,");
    await assert.rejects(prisma.$transaction(async tx=>{
      await createLegacyMasterRecords(tx,"COMMENT_TEMPLATE",org,
        conflict.map(row=>({...row,id:randomUUID()})));
    },{isolationLevel:"Serializable"}));
    assert.equal((await read("FRESH84")).length,0);
    assert.equal((await read("COMP84"))[0].text_en,"Review before activating");

    const [historicResults]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM laboratory_results WHERE 1=0");
    const [historicReports]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM diagnostic_reports WHERE 1=0");
    assert.equal(historicResults.length,0);
    assert.equal(historicReports.length,0);
  }finally {
    for(const id of auditIds)await writer.execute("DELETE FROM audit_events WHERE id=?",[id]).catch(()=>{});
    for(const row of cleanup)await writer.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([writer.end(),second.end(),prisma.$disconnect()]);
  }
});
