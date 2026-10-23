import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { portalLoginStillUniquelyOwned } from "../src/lib/portal-login-identity.ts";

test("F7 portal login: post-bcrypt MariaDB snapshot revocation and duplicate ownership fail closed",{timeout:60000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const connection={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [first,second]=await Promise.all([
    mysql.createConnection(connection),mysql.createConnection(connection),
  ]);
  const org=randomUUID(),otherOrg=randomUUID(),owner=randomUUID(),
    contender=randomUUID(),other=randomUUID();
  const code="LGCAS-"+org.slice(0,8),identity="login-"+org.slice(0,12)+"@example.invalid";

  async function currentAuthorized():Promise<boolean>{
    await first.beginTransaction();
    try{
      const [locked]=await first.execute<mysql.RowDataPacket[]>(
        "SELECT id,normalized_email,normalized_phone FROM portal_accounts "+
        "WHERE id=? AND organization_id=? FOR UPDATE",[owner,org]);
      const [organizations]=await first.execute<mysql.RowDataPacket[]>(
        "SELECT status FROM organizations WHERE id=?",[org]);
      const [matches]=await first.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM portal_accounts WHERE organization_id=? "+
        "AND (normalized_email=? OR normalized_phone=?) LIMIT 2",
        [org,identity,identity]);
      const result=locked.length===1 && organizations[0]?.status==="ACTIVE" &&
        portalLoginStillUniquelyOwned({
          id:locked[0].id,
          normalizedEmail:locked[0].normalized_email,
          normalizedPhone:locked[0].normalized_phone,
        },identity,matches.map(r=>r.id));
      await first.commit();
      return Boolean(result);
    } catch(e) { await first.rollback().catch(()=>{});throw e; }
  }
  try{
    await first.execute("INSERT INTO organizations (id,code,name_en,updated_at) "+
      "VALUES (?,?,?,NOW(3)),(?,?,?,NOW(3))",
      [org,code,"Synthetic Login CAS",otherOrg,"LGCAS-"+otherOrg.slice(0,8),"Other Tenant"]);
    for(const [id,tenant,contact] of [
      [owner,org,identity],[contender,org,null],[other,otherOrg,identity],
    ] as const){
      await first.execute("INSERT INTO portal_accounts "+
        "(id,organization_id,type,status,normalized_email,updated_at) "+
        "VALUES (?,?,'PATIENT','ACTIVE',?,NOW(3))",
        [id,tenant,contact]);
    }
    assert.equal(await currentAuthorized(),true,"single owner within active tenant allowed");
    const [initial]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM portal_accounts WHERE organization_id=? "+
      "AND normalized_email=? LIMIT 2",[org,identity]);
    assert.deepEqual(initial.map(x=>x.id),[owner],"bcrypt began with unique owner");
    // Simulate another connection changing ownership during bcrypt.
    await second.execute("UPDATE portal_accounts SET normalized_email=NULL WHERE id=?",[owner]);
    await second.execute("UPDATE portal_accounts SET normalized_email=? WHERE id=?",[identity,contender]);
    assert.equal(await currentAuthorized(),false,
      "stale initial lookup cannot create a session for contact now owned by another account");

    await second.execute("UPDATE portal_accounts SET normalized_email=? WHERE id=?",[identity,owner]);
    assert.equal(await currentAuthorized(),false,
      "contact that became ambiguous during bcrypt must not authenticate");

    await second.execute("UPDATE portal_accounts SET normalized_email=NULL WHERE id=?",[contender]);
    await second.execute("UPDATE organizations SET status='INACTIVE' WHERE id=?",[org]);
    assert.equal(await currentAuthorized(),false,"deactivated tenant invalidates even a unique contact");
    await second.execute("UPDATE organizations SET status='ACTIVE' WHERE id=?",[org]);
    assert.equal(await currentAuthorized(),true,"still-valid tenant/contact remains usable");
  } finally{
    for(const id of [owner,contender,other])
      await first.execute("DELETE FROM portal_accounts WHERE id=?",[id]).catch(()=>{});
    for(const id of [org,otherOrg])
      await first.execute("DELETE FROM organizations WHERE id=?",[id]).catch(()=>{});
    await Promise.all([first.end(),second.end()]);
  }
});
