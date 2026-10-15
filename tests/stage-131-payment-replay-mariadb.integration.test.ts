import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  lookupPaymentPosting, paymentPostingFingerprint,
} from "../src/lib/payment-posting-idempotency.ts";

test("Stage 131 MariaDB: committed payment replay distinguishes posted, partial refund, full refund and tampered history", {
  timeout: 75000,
}, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const opts = {host:url.hostname, port:Number(url.port||3306), user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password), database:url.pathname.slice(1)};
  const [db, rival] = await Promise.all([mysql.createConnection(opts), mysql.createConnection(opts)]);
  const ids = {org:randomUUID(),foreignOrg:randomUUID(),branch:randomUUID(),actor:randomUUID(),
    method:randomUUID(),invoice:randomUUID(),payment:randomUUID(),key:randomUUID()};
  const suffix=ids.org.slice(0,8);
  const cleanup: Array<{sql:string;ids:string[]}>=[];
  async function put(sql:string,args:(string|number)[],undo:string,ids:string[]) {
    await db.execute(sql,args);cleanup.unshift({sql:undo,ids});
  }
  const input = {kind:"INVOICE" as const,organizationId:ids.org,actorUserId:ids.actor,
    paymentMethodId:ids.method,legacyMethod:"",reference:"test-receipt",
    amount:"125.5000",allocations:[{invoiceId:ids.invoice,amount:"125.5"}]};
  const fingerprint=paymentPostingFingerprint(input);
  const snapshot={status:"ok",paymentId:ids.payment,invoiceNumber:"S131I"+suffix,
    paidAmount:"125.5000",balanceAmount:"0.0000",invoiceStatus:"PAID"};
  async function queryExisting(organizationId:string,postingKey:string) {
    const [rows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,refunded_amount,posting_fingerprint,posting_response_snapshot FROM payments WHERE organization_id=? AND posting_key=?",
      [organizationId,postingKey]);
    const row=rows[0];
    return row ? {id:row.id,status:row.status,refundedAmount:{toString:()=>String(row.refunded_amount)},
      postingFingerprint:row.posting_fingerprint,
      postingResponseSnapshot:typeof row.posting_response_snapshot==="string"
        ? JSON.parse(row.posting_response_snapshot):row.posting_response_snapshot} : null;
  }
  const adapter={payment:{findFirst:({where}:{where:{organizationId:string,postingKey:string}})=>
    queryExisting(where.organizationId,where.postingKey)}} as unknown as Parameters<typeof lookupPaymentPosting>[0];
  try {
    for (const [org,code] of [[ids.org,"A"],[ids.foreignOrg,"B"]])await put(
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"S131"+suffix+code,"Stage 131 test organization"],
      "DELETE FROM organizations WHERE id=?",[org]);
    await put("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [ids.branch,ids.org,"S131"+suffix,"Synthetic branch"],
      "DELETE FROM branches WHERE id=?",[ids.branch]);
    await put("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [ids.actor,ids.org,"stage131"+suffix,"Synthetic cashier"],
      "DELETE FROM users WHERE id=?",[ids.actor]);
    await put("INSERT INTO payment_method_configs(id,organization_id,code,name_en,base_method,updated_at) VALUES(?,?,?,'Stage 131 cash','CASH',NOW(3))",
      [ids.method,ids.org,"S131CASH"+suffix],
      "DELETE FROM payment_method_configs WHERE id=?",[ids.method]);
    await put("INSERT INTO invoices(id,organization_id,branch_id,invoice_number,currency,total,paid_amount,balance_amount,status,created_by_user_id,updated_at) VALUES(?,?,?,?, 'AED',125.5000,125.5000,0,'PAID',?,NOW(3))",
      [ids.invoice,ids.org,ids.branch,snapshot.invoiceNumber,ids.actor],
      "DELETE FROM invoices WHERE id=?",[ids.invoice]);
    await put("INSERT INTO payments(id,organization_id,branch_id,amount,currency,method,payment_method_config_id,payment_method_code_snapshot,payment_method_name_en_snapshot,cashier_user_id,posting_key,posting_fingerprint,posting_response_snapshot,reference) VALUES(?,?,?,125.5000,'AED','CASH',?,?,?, ?,?,?,?,?)",
      [ids.payment,ids.org,ids.branch,ids.method,"S131CASH"+suffix,"Stage 131 cash",ids.actor,ids.key,fingerprint,JSON.stringify(snapshot),"test-receipt"],
      "DELETE FROM payments WHERE id=?",[ids.payment]);
    await put("INSERT INTO payment_allocations(payment_id,invoice_id,amount) VALUES(?,?,125.5000)",
      [ids.payment,ids.invoice],
      "DELETE FROM payment_allocations WHERE payment_id=?",[ids.payment]);

    assert.equal((await lookupPaymentPosting(adapter,ids.org,ids.key,fingerprint))?.kind,"replay",
      "completed paid invoice must still allow exact replay of an unreversed payment");
    assert.equal(await lookupPaymentPosting(adapter,ids.foreignOrg,ids.key,fingerprint),null,
      "tenant boundary must not disclose an existing payment");
    assert.equal((await lookupPaymentPosting(adapter,ids.org,ids.key,
      paymentPostingFingerprint({...input,actorUserId:randomUUID()})))?.kind,"conflict");

    await db.beginTransaction();
    await db.execute("SELECT id FROM payments WHERE id=? FOR UPDATE",[ids.payment]);
    await db.execute("UPDATE payments SET refunded_amount=12.5000,status='POSTED' WHERE id=?",[ids.payment]);
    await rival.query("SET SESSION innodb_lock_wait_timeout=1");
    await rival.beginTransaction();
    await assert.rejects(rival.execute("SELECT id FROM payments WHERE id=? FOR UPDATE",[ids.payment]),
      (error:unknown)=>Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="ER_LOCK_WAIT_TIMEOUT"));
    await rival.rollback();
    await db.commit();
    assert.equal((await lookupPaymentPosting(adapter,ids.org,ids.key,fingerprint))?.kind,"changed",
      "partial refund cannot report an obsolete fully-paid snapshot");
    await rival.execute("UPDATE payments SET refunded_amount=125.5000,status='REFUNDED' WHERE id=?",[ids.payment]);
    assert.equal((await lookupPaymentPosting(adapter,ids.org,ids.key,fingerprint))?.kind,"changed",
      "full refund cannot replay original success");
    await rival.execute("UPDATE payments SET refunded_amount=0,status='VOIDED' WHERE id=?",[ids.payment]);
    assert.equal((await lookupPaymentPosting(adapter,ids.org,ids.key,fingerprint))?.kind,"changed");
    await rival.execute("UPDATE payments SET status='POSTED' WHERE id=?",[ids.payment]);
    await rival.execute("UPDATE payments SET posting_response_snapshot=? WHERE id=?",
      [JSON.stringify({...snapshot,paymentId:randomUUID()}),ids.payment]);
    assert.equal((await lookupPaymentPosting(adapter,ids.org,ids.key,fingerprint))?.kind,"conflict",
      "snapshot paymentId must equal persisted payment id");
    await assert.rejects(rival.execute(
      "INSERT INTO payments(id,organization_id,branch_id,amount,currency,method,payment_method_config_id,payment_method_code_snapshot,payment_method_name_en_snapshot,cashier_user_id,posting_key,posting_fingerprint) VALUES(?,?,?,125.5000,'AED','CASH',?,?,?, ?,?,?)",
      [randomUUID(),ids.org,ids.branch,ids.method,"S131CASH"+suffix,"Stage 131 cash",ids.actor,ids.key,fingerprint]),
      (e:unknown)=>Boolean(e&&typeof e==="object"&&"code" in e&&e.code==="ER_DUP_ENTRY"));
    const [count]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM payment_allocations WHERE payment_id=?",[ids.payment]);
    assert.equal(Number(count[0].n),1,"retries did not create duplicate ledger allocations");
  } finally {
    await Promise.all([db.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
    for(const row of cleanup)await db.execute(row.sql,row.ids).catch(()=>{});
    await Promise.all([db.end(),rival.end()]);
  }
});
