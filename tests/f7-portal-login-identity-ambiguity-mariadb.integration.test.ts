import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";

test("F7 portal login: tenant-scoped email and phone collisions are detectable in actual MariaDB",{timeout:60000},async()=>{
  if(!process.env.DATABASE_URL)throw new Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const db=await mysql.createConnection({
    host:url.hostname, port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1),
  });
  const a=randomUUID(),b=randomUUID(),codeA="LOGIN-"+a.slice(0,8),codeB="LOGIN-"+b.slice(0,8);
  const ids=[randomUUID(),randomUUID(),randomUUID()];
  const identity="login-"+a.slice(0,12)+"@example.invalid";
  const query=async(code:string)=> {
    // Reproduce the login route's tenant + normalizedEmail OR normalizedPhone
    // match, with LIMIT 2 instead of the unsafe arbitrary LIMIT 1.
    const [rows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT p.id FROM portal_accounts p "+
      "JOIN organizations o ON o.id=p.organization_id "+
      "WHERE o.code=? AND o.status='ACTIVE' "+
      "AND (p.normalized_email=? OR p.normalized_phone=?) LIMIT 2",
      [code,identity,identity]);
    return rows.map(row=>row.id);
  };
  try{
    await db.execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3)),(?,?,?,NOW(3))",
      [a,codeA,"Synthetic Login A",b,codeB,"Synthetic Login B"]);
    for(const [idx,org] of [[0,a],[1,a],[2,b]] as const) {
      await db.execute(
        "INSERT INTO portal_accounts(id,organization_id,type,status,normalized_email,updated_at) "+
        "VALUES (?,?,'PATIENT','ACTIVE',?,NOW(3))",
        [ids[idx],org,identity]);
    }
    assert.equal((await query(codeA)).length,2,
      "duplicate normalized emails in one tenant must not yield an arbitrary login");
    assert.deepEqual(await query(codeB),[ids[2]],
      "identical login in another organization must remain independently valid");
    await db.execute("UPDATE portal_accounts SET normalized_email=NULL,normalized_phone=? WHERE id=?",
      [identity,ids[1]]);
    assert.equal((await query(codeA)).length,2,
      "cross-field email/phone matching in one tenant is also ambiguous");
    await db.execute("UPDATE portal_accounts SET normalized_phone='9000000000' WHERE id=?",[ids[1]]);
    assert.deepEqual(await query(codeA),[ids[0]],
      "once duplicate contact ownership is corrected, one account is allowed");
    await db.execute("UPDATE portal_accounts SET normalized_email=? WHERE id=?",[identity,ids[1]]);
    await db.execute("UPDATE portal_accounts SET status='DISABLED' WHERE id=?",[ids[1]]);
    assert.equal((await query(codeA)).length,2,
      "disabling one ambiguous account must not silently pick the other");
    await db.execute("UPDATE organizations SET status='INACTIVE' WHERE id=?",[a]);
    assert.equal((await query(codeA)).length,0,
      "inactive tenant cannot log in even with a unique contact identity");
  }finally{
    for(const id of ids) await db.execute("DELETE FROM portal_accounts WHERE id=?",[id]).catch(()=>{});
    for(const id of [a,b])await db.execute("DELETE FROM organizations WHERE id=?",[id]).catch(()=>{});
    await db.end();
  }
});
