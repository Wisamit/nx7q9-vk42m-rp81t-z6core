import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

test("F7 portal account provisioning: real MariaDB parent-row lock prevents two accounts claiming one contact",{timeout:60000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const options={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [a,b]=await Promise.all([mysql.createConnection(options),mysql.createConnection(options)]);
  const orgA=randomUUID(),orgB=randomUUID(),codeA="PAP-"+orgA.slice(0,8);
  const email="portal-"+orgA.slice(0,12)+"@example.invalid";
  const created:string[]=[];
  async function provision(conn:typeof a,organizationId:string,contact:string) {
    await conn.beginTransaction();
    try{
      const [live]=await conn.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",
        [organizationId]);
      if(live.length!==1){await conn.rollback();return "INACTIVE";}
      const [matched]=await conn.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM portal_accounts WHERE organization_id=? "+
        "AND (normalized_email=? OR normalized_phone=?) LIMIT 1",
        [organizationId,contact,contact]);
      if(matched.length){await conn.rollback();return "DUPLICATE";}
      const id=randomUUID();
      await conn.execute(
        "INSERT INTO portal_accounts(id,organization_id,type,status,normalized_email,updated_at) "+
        "VALUES (?,?,'PATIENT','INVITED',?,NOW(3))",
        [id,organizationId,contact]);
      created.push(id);
      await conn.commit();
      return id;
    }catch(e){
      await conn.rollback().catch(()=>{});
      throw e;
    }
  }
  try{
    await a.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES "+
      "(?,?,?,NOW(3)),(?,?,?,NOW(3))",
      [orgA,codeA,"Synthetic Portal Provision A",orgB,"PAP-"+orgB.slice(0,8),"Synthetic Portal Provision B"]);
    const results=await Promise.all([provision(a,orgA,email),provision(b,orgA,email)]);
    assert.equal(results.filter(x=>x!=="DUPLICATE").length,1);
    assert.equal(results.filter(x=>x==="DUPLICATE").length,1,
      "both concurrent attempts cannot own identical contact in one tenant");
    const [rows]=await a.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM portal_accounts WHERE organization_id=? AND normalized_email=?",
      [orgA,email]);
    assert.equal(rows.length,1);
    const secondTenant=await provision(b,orgB,email);
    assert.notEqual(secondTenant,"DUPLICATE","same contact in independent tenant remains allowed");
    await a.execute("UPDATE organizations SET status='INACTIVE' WHERE id=?",[orgA]);
    assert.equal(await provision(a,orgA,"different-"+email),"INACTIVE");
  }finally{
    for(const id of created)await a.execute("DELETE FROM portal_accounts WHERE id=?",[id]).catch(()=>{});
    for(const orgId of [orgA,orgB])await a.execute("DELETE FROM organizations WHERE id=?",[orgId]).catch(()=>{});
    await Promise.all([a.end(),b.end()]);
  }
});
