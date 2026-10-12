import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { legacyMasterFingerprint,parseLegacyMasterCsv } from "../src/lib/legacy-master-data-import.ts";

test("Stage 83 MariaDB: reviewed client master batch is create-only, audited, tenant-scoped and atomically rejects conflicting codes",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const cfg={host:uri.hostname,port:Number(uri.port||3306),user:decodeURIComponent(uri.username),
    password:decodeURIComponent(uri.password),database:uri.pathname.slice(1)};
  const [writer,competitor]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),actor=randomUUID();
  const tag=org.slice(0,8);
  const created:Array<{table:string;id:string}>=[];
  const audits:string[]=[];
  const header="code,name_en,name_ar,type,phone,email,address_en,address_ar,payment_terms_days";
  const csv=header+"\n"+
    "INS83,Insurer Group,شركة تأمين,INSURANCE,0500000011,insurer@example.org,Office A,مكتب أ,60\n"+
    "CL83,Medical Clinic,العيادة الطبية,CLINIC,,,,,";
  const rows=parseLegacyMasterCsv("CLIENT",csv);
  const fingerprint=legacyMasterFingerprint(org,"CLIENT",rows);
  async function add(db:mysql.Connection,id:string,tenant:string,row:(typeof rows)[number]){
    await db.execute(
      "INSERT INTO clients(id,organization_id,code,type,name_en,name_ar,phone,email,"+
      "address_en,address_ar,payment_terms_days,updated_at) "+
      "VALUES(?,?,?,?,?,?,?,?,?,?,?,NOW(3))",
      [id,tenant,row.code,row.clientType,row.nameEn,row.nameAr,row.phone,row.email,
        row.addressEn,row.addressAr,row.paymentTermsDays]);
  }
  async function fetchClients(tenant:string,code:string){
    const [data]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,type,name_en,name_ar,phone,email,address_en,address_ar,payment_terms_days "+
      "FROM clients WHERE organization_id=? AND code=?",[tenant,code]);
    return data;
  }
  try {
    for(const [id,code] of [[org,"A"],[foreignOrg,"B"]]){
      await writer.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S83"+tag+code,"Stage83 Tenant"]);
      created.unshift({table:"organizations",id});
    }
    await writer.execute("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S83"+tag,"Stage83 Branch"]);
    created.unshift({table:"branches",id:branch});
    await writer.execute("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor,org,"s83"+tag,"Stage83 Import Manager"]);
    created.unshift({table:"users",id:actor});

    const ids=rows.map(()=>randomUUID());
    await writer.beginTransaction();
    try {
      for(let i=0;i<rows.length;i++) {
        await add(writer,ids[i],org,rows[i]);
        const auditId=randomUUID();
        await writer.execute(
          "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) "+
          "VALUES(?,?,?,?,'LEGACY_MASTER_RECORD_CREATED','CLIENT',?,?)",
          [auditId,org,branch,actor,ids[i],JSON.stringify({
            importKind:"CLIENT",fingerprint,code:rows[i].code,
            paymentTermsDays:rows[i].paymentTermsDays,
            financialScope:"MASTER_ONLY_NO_CONTRACTS_PRICES_OR_BALANCES",
          })]);
        audits.push(auditId);
      }
      await writer.commit();
      for(const id of ids)created.unshift({table:"clients",id});
    }catch(e){await writer.rollback();throw e;}

    const insurer=await fetchClients(org,"INS83"),clinic=await fetchClients(org,"CL83");
    assert.equal(insurer.length,1);assert.equal(clinic.length,1);
    assert.equal(insurer[0].name_ar,"شركة تأمين");
    assert.equal(insurer[0].type,"INSURANCE");
    assert.equal(Number(insurer[0].payment_terms_days),60);
    assert.equal(insurer[0].address_ar,"مكتب أ");
    assert.equal(insurer[0].email,"insurer@example.org");
    assert.equal(clinic[0].payment_terms_days,null,"blank terms are not guessed");
    assert.equal(clinic[0].name_en,"Medical Clinic");
    const [invoices]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM invoices WHERE client_id IN (?,?)",[...ids]);
    const [contracts]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM contracts WHERE client_id IN (?,?)",[...ids]);
    const [pricing]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM price_lists WHERE client_id IN (?,?)",[...ids]);
    assert.equal(invoices.length,0);assert.equal(contracts.length,0);assert.equal(pricing.length,0);
    const [logged]=await writer.execute<mysql.RowDataPacket[]>(
      "SELECT entity_id FROM audit_events WHERE organization_id=? AND action='LEGACY_MASTER_RECORD_CREATED' AND entity_type='CLIENT'",
      [org]);
    assert.equal(logged.length,2);
    assert.deepEqual(new Set(logged.map(row=>String(row.entity_id))),new Set(ids));

    // A different tenant may legitimately use the same external master code.
    const foreignId=randomUUID();
    await add(competitor,foreignId,foreignOrg,rows[0]);
    created.unshift({table:"clients",id:foreignId});
    assert.equal((await fetchClients(foreignOrg,"INS83")).length,1);
    assert.equal((await fetchClients(org,"INS83"))[0].id,ids[0]);

    // Conflicting second row MUST roll back the first row, with no partial
    // master/ledger or audit data left behind.
    const [fresh,conflict]=parseLegacyMasterCsv("CLIENT",header+"\n"+
      "NEW83,New Company,شركة جديدة,COMPANY,,,,,30\n"+
      "INS83,Attempted overwrite,تعديل ممنوع,COMPANY,,,,,0");
    const freshId=randomUUID(),collisionId=randomUUID();
    let rejected=false;
    await competitor.beginTransaction();
    try {
      await add(competitor,freshId,org,fresh);
      await add(competitor,collisionId,org,conflict);
      await competitor.commit();
    }catch{rejected=true;await competitor.rollback();}
    assert.equal(rejected,true);
    assert.equal((await fetchClients(org,"NEW83")).length,0);
    const unchanged=await fetchClients(org,"INS83");
    assert.equal(unchanged.length,1);
    assert.equal(unchanged[0].type,"INSURANCE");
    assert.equal(unchanged[0].payment_terms_days,60);
    assert.equal(unchanged[0].name_en,"Insurer Group");
  }finally {
    for(const id of audits) await writer.execute("DELETE FROM audit_events WHERE id=?",[id]).catch(()=>{});
    for(const row of created)await writer.execute("DELETE FROM "+row.table+" WHERE id=?",[row.id]).catch(()=>{});
    await Promise.all([writer.end(),competitor.end()]);
  }
});
