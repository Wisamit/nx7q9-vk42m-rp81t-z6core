import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID,createHash} from "node:crypto";
import mysql from "mysql2/promise";

/** Two real physical MariaDB connections, not a mocked rate limiter. */
test("F7 rate limiting: concurrent increments and window rollover cannot lose counts",{
  timeout:60000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required for rate limit concurrency");
  const url=new URL(process.env.DATABASE_URL);
  const options={host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [one,two]=await Promise.all([mysql.createConnection(options),mysql.createConnection(options)]);
  const scope="f7_rate_cas_"+randomUUID().slice(0,8),hash=createHash("sha256").update(randomUUID()).digest("hex");
  const windowMs=60_000;
  const current=new Date(Math.floor(Date.now()/windowMs)*windowMs);
  const older=new Date(current.getTime()-windowMs);
  async function issue(conn:typeof one,windowStart:Date){
    await conn.beginTransaction();
    try {
      await conn.execute(
        "INSERT INTO request_rate_limits(id,scope,key_hash,window_start,count,updated_at) "+
        "VALUES (?,?,?,?,1,NOW(3)) ON DUPLICATE KEY UPDATE "+
        "count=IF(window_start<?,1,count+1),"+
        "window_start=GREATEST(window_start,?),updated_at=NOW(3)",
        [randomUUID(),scope,hash,windowStart,windowStart,windowStart]);
      const [rows]=await conn.execute<mysql.RowDataPacket[]>(
        "SELECT count,window_start FROM request_rate_limits "+
        "WHERE scope=? AND key_hash=? FOR UPDATE",[scope,hash]);
      assert.equal(rows.length,1);
      await conn.commit();
      return {count:Number(rows[0].count),start:new Date(rows[0].window_start).getTime()};
    }catch(error){await conn.rollback().catch(()=>{});throw error;}
  }
  try {
    const [left,right]=await Promise.all([one,two].map(async conn=>{
      const values=[] as Awaited<ReturnType<typeof issue>>[];
      for(let i=0;i<15;i++)values.push(await issue(conn,current));
      return values;
    }));
    const counts=[...left,...right].map(x=>x.count).sort((a,b)=>a-b);
    assert.deepEqual(counts,Array.from({length:30},(_,i)=>i+1),
      "each concurrent request must consume a distinct rate-budget token");
    assert.equal([...left,...right].filter(x=>x.count<=5).length,5,
      "no more than five calls pass a five-request limit, even across connections");
    assert.ok([...left,...right].every(x=>x.start===current.getTime()));

    // Simulate a prior expired window; two new requests must not both
    // overwrite count with 1 when their pre-read window appears old.
    await one.execute("UPDATE request_rate_limits SET window_start=?,count=999 "+
      "WHERE scope=? AND key_hash=?",[older,scope,hash]);
    const rollover=await Promise.all([issue(one,current),issue(two,current)]);
    assert.deepEqual(rollover.map(x=>x.count).sort((a,b)=>a-b),[1,2]);
    assert.ok(rollover.every(x=>x.start===current.getTime()));

    // A request calculated under the old clock window and delayed until
    // later cannot roll the row backward or revive exhausted quota.
    const late=await issue(two,older);
    assert.equal(late.count,3);
    assert.equal(late.start,current.getTime());
  }finally{
    await one.rollback().catch(()=>{});
    await one.execute("DELETE FROM request_rate_limits WHERE scope=? AND key_hash=?",
      [scope,hash]).catch(()=>{});
    await Promise.all([one.end(),two.end()]);
  }
});
