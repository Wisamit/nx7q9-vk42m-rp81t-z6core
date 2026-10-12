import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  parseLegacyMasterCsv, legacyMasterFingerprint, type LegacyMasterKind,
  type LegacyMasterRow,
} from "../src/lib/legacy-master-data-import.ts";

const fixtures: Record<LegacyMasterKind,string> = {
  REFERRER:"code,name_en,name_ar,type,phone,email,license_number\nDOCTOR1,Dr Ali,د علي,PHYSICIAN,0500000000,ali@example.com,LIC001",
  SOURCE:"code,name_en,name_ar,category\nCAMPAIGN1,Referral Campaign,حملة إحالة,CAMPAIGN",
  ORGANISM:"code,name_en,name_ar,category\nECOLI1,Escherichia coli,إشريكية قولونية,Gram negative",
  ANTIBIOTIC:"code,name_en,name_ar,drug_class\nAMOX1,Amoxicillin,أموكسيسيلين,Penicillins",
  CLIENT:"code,name_en,name_ar,type,phone,email,address_en,address_ar,payment_terms_days\nCL82,Corporate client,عميل مؤسسة,COMPANY,,,,,30",
};
const tables:Record<LegacyMasterKind,string> = {
  REFERRER:"referrers",SOURCE:"order_sources",ORGANISM:"organisms",ANTIBIOTIC:"antibiotics",CLIENT:"clients",
};

test("Stage 82 MariaDB: safe audited create-only legacy reference masters across tenants with atomic conflict rollback",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [writer,competitor]=await Promise.all([
    mysql.createConnection(cfg),mysql.createConnection(cfg),
  ]);
  const tenant=randomUUID(),foreignTenant=randomUUID(),branch=randomUUID(),
    user=randomUUID(),tag=tenant.slice(0,8);
  const created:Array<{table:string;id:string}>=[];
  const persistedIds:string[]=[];
  const insertedAudit:string[]=[];
  async function seed(table:string,id:string,sql:string,args:(string|number|null)[]){
    await writer.execute(sql,args);created.unshift({table,id});
  }
  async function read(table:string,organizationId:string,code:string){
    const [rows]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,name_en,name_ar FROM "+table+" WHERE organization_id=? AND code=?",
      [organizationId,code]);
    return rows;
  }
  async function add(db:mysql.Connection,kind:LegacyMasterKind,organizationId:string,row:LegacyMasterRow,id:string){
    if(kind==="REFERRER")await db.execute(
      "INSERT INTO referrers(id,organization_id,code,type,name_en,name_ar,phone,email,license_number,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,?,?,NOW(3))",
      [id,organizationId,row.code,row.type,row.nameEn,row.nameAr,row.phone,row.email,row.licenseNumber]);
    else if(kind==="SOURCE")await db.execute(
      "INSERT INTO order_sources(id,organization_id,code,category,name_en,name_ar,updated_at) "+
      "VALUES(?,?,?,?,?,?,NOW(3))",
      [id,organizationId,row.code,row.category,row.nameEn,row.nameAr]);
    else if(kind==="ORGANISM")await db.execute(
      "INSERT INTO organisms(id,organization_id,code,name_en,name_ar,category,updated_at) "+
      "VALUES(?,?,?,?,?,?,NOW(3))",
      [id,organizationId,row.code,row.nameEn,row.nameAr,row.category]);
    else await db.execute(
      "INSERT INTO antibiotics(id,organization_id,code,name_en,name_ar,drug_class,updated_at) "+
      "VALUES(?,?,?,?,?,?,NOW(3))",
      [id,organizationId,row.code,row.nameEn,row.nameAr,row.drugClass]);
  }
  try{
    for(const [id,code] of [[tenant,"A"],[foreignTenant,"B"]]){
      await seed("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S82"+tag+code,"Stage82 Tenant"]);
    }
    await seed("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,tenant,"S82"+tag,"Stage82 Branch"]);
    await seed("users",user,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [user,tenant,"s82"+tag,"Stage82 Migration Reviewer"]);

    // Normalized legacy codes and bilingual names round-trip through each
    // real MariaDB master table. Every insert and audit is one transaction.
    for(const kind of ["REFERRER","SOURCE","ORGANISM","ANTIBIOTIC"] as const){
      const rows=parseLegacyMasterCsv(kind,fixtures[kind]);
      const entry=rows[0],id=randomUUID(),auditId=randomUUID();
      const fingerprint=legacyMasterFingerprint(tenant,kind,rows);
      await writer.beginTransaction();
      try{
        await add(writer,kind,tenant,entry,id);
        await writer.execute(
          "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,"+
          "entity_type,entity_id,new_values) "+
          "VALUES(?,?,?,?,'LEGACY_MASTER_RECORD_CREATED',?,?,?)",
          [auditId,tenant,branch,user,kind,id,
            JSON.stringify({fingerprint,code:entry.code,nameEn:entry.nameEn,sourceName:"legacy.csv"})]);
        await writer.commit();
      }catch(err){await writer.rollback();throw err;}
      created.unshift({table:tables[kind],id});
      insertedAudit.push(auditId);
      persistedIds.push(id);
      const found=await read(tables[kind],tenant,entry.code);
      assert.equal(found.length,1);
      assert.equal(found[0].id,id);
      assert.equal(found[0].name_ar,entry.nameAr);
      const [aud]=await writer.execute<mysql.RowDataPacket[]>(
        "SELECT action,entity_id FROM audit_events WHERE id=? AND organization_id=?",
        [auditId,tenant]);
      assert.equal(aud.length,1);
      assert.equal(aud[0].entity_id,id);
      assert.equal(aud[0].action,"LEGACY_MASTER_RECORD_CREATED");
    }

    // Organization-scoped codes are independent; foreign master codes must
    // never be mistaken for current tenant's codes.
    const foreignId=randomUUID();
    const foreignRow=parseLegacyMasterCsv("SOURCE",fixtures.SOURCE)[0];
    await add(competitor,"SOURCE",foreignTenant,foreignRow,foreignId);
    created.unshift({table:"order_sources",id:foreignId});
    assert.equal((await read("order_sources",tenant,foreignRow.code)).length,1);
    assert.equal((await read("order_sources",foreignTenant,foreignRow.code)).length,1);

    // Duplicate already-existing code aborts entire import; the new record
    // created earlier in the same transaction must roll back, not survive.
    const firstId=randomUUID(),secondId=randomUUID();
    const [newRow,dup]=parseLegacyMasterCsv("SOURCE",
      "code,name_en,name_ar,category\nNEW_S82,New Source,مصدر جديد,OTHER\nCAMPAIGN1,Overwrite Attempt,محاولة,OTHER");
    await competitor.beginTransaction();
    let conflict=false;
    try{
      await add(competitor,"SOURCE",tenant,newRow,firstId);
      await add(competitor,"SOURCE",tenant,dup,secondId);
      await competitor.commit();
    }catch{
      conflict=true;
      await competitor.rollback();
    }
    assert.equal(conflict,true,"DB uniqueness must reject conflicting batch");
    assert.equal((await read("order_sources",tenant,"NEW_S82")).length,0);
    const original=await read("order_sources",tenant,"CAMPAIGN1");
    assert.equal(original.length,1);
    assert.equal(original[0].name_en,"Referral Campaign");
    const [count]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_events WHERE organization_id=? AND action='LEGACY_MASTER_RECORD_CREATED'",
      [tenant]);
    assert.equal(Number(count[0].n),4,"only successful transactions were audited");
    assert.equal(new Set(persistedIds).size,4);
  }finally{
    for(const id of insertedAudit)await writer.execute("DELETE FROM audit_events WHERE id=?",[id]).catch(()=>{});
    for(const row of created)await writer.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([writer.end(),competitor.end()]);
  }
});
