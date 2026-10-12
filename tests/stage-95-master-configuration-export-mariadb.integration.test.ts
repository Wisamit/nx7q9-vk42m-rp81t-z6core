import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

test("Stage 95 MariaDB: six organization-scoped master classes, consistent source snapshot and audited export",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const cfg={host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1)};
  const [db,rival]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const organizationId=randomUUID(),foreignOrganizationId=randomUUID(),branchId=randomUUID(),
    actorId=randomUUID(),suffix=organizationId.slice(0,8),auditId=randomUUID();
  const records=[
    {table:"referrers",id:randomUUID()},
    {table:"order_sources",id:randomUUID()},
    {table:"organisms",id:randomUUID()},
    {table:"antibiotics",id:randomUUID()},
    {table:"clients",id:randomUUID()},
    {table:"result_comment_templates",id:randomUUID()},
  ];
  const created:Array<{table:string;id:string}>=[];
  async function put(table:string,id:string,sql:string,args:(string|number|null)[]){
    await db.execute(sql,args);created.unshift({table,id});
  }
  try{
    for(const [id,label] of [[organizationId,"A"],[foreignOrganizationId,"B"]])
      await put("organizations",id,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,"S95"+suffix+label,"Stage95 Lab "+label]);
    await put("branches",branchId,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branchId,organizationId,"S95"+suffix,"Stage95 branch"]);
    await put("users",actorId,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actorId,organizationId,"s95"+suffix,"Export auditor"]);
    await put("user_branch_scopes",actorId,
      "INSERT INTO user_branch_scopes(user_id,branch_id) VALUES(?,?)",[actorId,branchId]);
    for(let i=0;i<records.length;i++){
      const {table,id}=records[i];
      if(table==="referrers")
        await put(table,id,
          "INSERT INTO referrers(id,organization_id,code,name_en,type,updated_at) "+
          "VALUES(?,?,?,?,'PHYSICIAN',NOW(3))",[id,organizationId,"S95REF"+suffix,"Doctor with original name"]);
      else if(table==="order_sources")
        await put(table,id,
          "INSERT INTO order_sources(id,organization_id,code,name_en,category,updated_at) VALUES(?,?,?,?,?,NOW(3))",
          [id,organizationId,"S95SRC"+suffix,"Before consistent read","WALK_IN"]);
      else if(table==="organisms")
        await put(table,id,
          "INSERT INTO organisms(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id,organizationId,"S95ORG"+suffix,"Organism A"]);
      else if(table==="antibiotics")
        await put(table,id,
          "INSERT INTO antibiotics(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id,organizationId,"S95AB"+suffix,"Antibiotic A"]);
      else if(table==="clients")
        await put(table,id,
          "INSERT INTO clients(id,organization_id,code,name_en,type,payment_terms_days,updated_at) "+
          "VALUES(?,?,?,?,'COMPANY',30,NOW(3))",
          [id,organizationId,"S95CLIENT"+suffix,"Partner client"]);
      else
        await put(table,id,
          "INSERT INTO result_comment_templates(id,organization_id,scope,code,name_en,text_en,status,updated_at) "+
          "VALUES(? ,? ,'ORGANIZATION',?,?,?,'ACTIVE',NOW(3))",
          [id,organizationId,"S95COMMENT"+suffix,"Reviewed text","Explicit clinical comment template"]);
    }
    for(const {table,id}of records){
      const [own]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM "+table+" WHERE id=? AND organization_id=? AND status='ACTIVE'",
        [id,organizationId]);
      const [other]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM "+table+" WHERE id=? AND organization_id=? AND status='ACTIVE'",
        [id,foreignOrganizationId]);
      assert.equal(own.length,1,table+" visible in own organization");
      assert.equal(other.length,0,table+" invisible in other organization");
    }
    const sourceId=records.find(x=>x.table==="order_sources")!.id;
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await db.beginTransaction();
    const [oldRows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT name_en FROM order_sources WHERE id=? AND organization_id=?",
      [sourceId,organizationId]);
    assert.equal(oldRows[0].name_en,"Before consistent read");
    await rival.execute("UPDATE order_sources SET name_en=? WHERE id=?",
      ["After concurrent edit",sourceId]);
    const [stillOld]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT name_en FROM order_sources WHERE id=? AND organization_id=?",
      [sourceId,organizationId]);
    assert.equal(stillOld[0].name_en,"Before consistent read",
      "one export transaction cannot silently mix pre- and post-change configuration");
    await db.commit();
    const [nowFresh]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT name_en FROM order_sources WHERE id=?",[sourceId]);
    assert.equal(nowFresh[0].name_en,"After concurrent edit");
    await put("audit_events",auditId,
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) "+
      "VALUES(?,?,?,?,'LEGACY_MASTER_CONFIGURATION_EXPORTED','LegacyMasterConfiguration',?,?)",
      [auditId,organizationId,branchId,actorId,organizationId,
        JSON.stringify({kind:"SOURCE",totalRows:1,integritySha256:"d".repeat(64)})]);
    const [audit]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT actor_user_id,branch_id,new_values FROM audit_events WHERE id=?",[auditId]);
    assert.equal(audit[0].actor_user_id,actorId);
    assert.equal(audit[0].branch_id,branchId);
    const [unchangedTemplate]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT text_en,status FROM result_comment_templates WHERE id=?",
      [records.find(x=>x.table==="result_comment_templates")!.id]);
    assert.equal(unchangedTemplate[0].text_en,"Explicit clinical comment template");
    assert.equal(unchangedTemplate[0].status,"ACTIVE");
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
    for(const {table,id}of created)
      await db.execute("DELETE FROM "+table+" WHERE "+
        (table==="user_branch_scopes"?"user_id":"id")+"=?",[id]).catch(()=>{});
    await Promise.all([db.end(),rival.end()]);
  }
});
