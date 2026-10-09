import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { aggregateFinancialReport } from "../src/lib/financial-reporting.ts";

test("MariaDB analytics keep DECIMAL precision, branch scope and credit-note attribution", { timeout: 40000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const db = await mysql.createConnection({
    host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1),
  });
  const id=()=>randomUUID();
  const org=id(), a=id(), b=id(), user=id(), inv1=id(),inv2=id(),inv3=id(),invVoid=id(),credit=id();
  const suffix=org.slice(0,8);
  const clean:Array<{sql:string,params:string[]}>=[];
  async function seed(sql:string,params:string[],undo:string,values:string[]) {
    await db.execute(sql,params);
    clean.unshift({sql:undo,params:values});
  }
  try {
    await seed("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"AN-"+suffix,"Analytics CI"],"DELETE FROM organizations WHERE id=?",[org]);
    await seed("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [a,org,"AN-A-"+suffix,"Reporting A"],"DELETE FROM branches WHERE id=?",[a]);
    await seed("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [b,org,"AN-B-"+suffix,"Reporting B"],"DELETE FROM branches WHERE id=?",[b]);
    await seed("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [user,org,"an-"+suffix,"Reporting User"],"DELETE FROM users WHERE id=?",[user]);
    const invoiceSql="INSERT INTO invoices(id,organization_id,branch_id,invoice_number,currency,subtotal,total,balance_amount,created_by_user_id,status,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,NOW(3))";
    for(const [invoice,branch,number,currency,amount,status] of [
      [inv1,a,"A-"+suffix,"EGP","99999999999999.9999","ISSUED"],
      [inv2,a,"B-"+suffix,"USD","3.0001","ISSUED"],
      [inv3,b,"C-"+suffix,"EGP","7.0000","ISSUED"],
      [invVoid,a,"D-"+suffix,"EGP","50.0000","VOID"],
    ]) {
      await seed(invoiceSql,[invoice,org,branch,number,currency,amount,amount,amount,user,status],
        "DELETE FROM invoices WHERE id=?",[invoice]);
    }
    await seed("INSERT INTO credit_notes(id,organization_id,branch_id,invoice_id,credit_note_number,currency,amount,reason,invoice_total_snapshot,credited_before_snapshot,balance_before_snapshot,credited_after_snapshot,balance_after_snapshot,issued_by_user_id) VALUES (?,?,?,?,?, 'EGP',5.0000,'Adjustment',99999999999999.9999,0,99999999999999.9999,5,99999999999994.9999,?)",
      [credit,org,a,inv1,"CR-"+suffix,user],
      "DELETE FROM credit_notes WHERE id=?",[credit]);

    const [scoped] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT currency, CAST(SUM(subtotal) AS CHAR) subtotal, CAST(SUM(total) AS CHAR) total, CAST(SUM(balance_amount) AS CHAR) balanceAmount FROM invoices WHERE organization_id=? AND branch_id=? AND status <> 'VOID' GROUP BY currency ORDER BY currency",
      [org,a]);
    assert.equal(scoped.length,2);
    assert.equal(scoped[0].currency,"EGP");
    assert.equal(scoped[0].total,"99999999999999.9999");
    assert.equal(scoped[1].currency,"USD");
    assert.equal(scoped[1].total,"3.0001");

    const [credits] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT currency, CAST(amount AS CHAR) amount FROM credit_notes WHERE organization_id=? AND branch_id=? AND status='ISSUED'",
      [org,a]);
    assert.equal(credits.length,1);
    const summary=aggregateFinancialReport({
      invoices: scoped.map(row=>({
        currency:row.currency,
        subtotal:row.subtotal,discountTotal:"0.0000",taxTotal:"0.0000",
        total:row.total,balanceAmount:row.balanceAmount,
      })),
      paymentAllocations:[],refunds:[],
      creditNotes:credits.map(row=>({currency:row.currency,amount:row.amount})),
    });
    assert.equal(summary[0].gross,"99999999999999.9999");
    assert.equal(summary[0].creditNotes,"5.0000");
    assert.equal(summary[1].gross,"3.0001");
    assert.equal(summary[1].creditNotes,"0.0000");
    const [foreign] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM invoices WHERE branch_id=? AND id=?",[a,inv3]);
    assert.equal(foreign.length,0);
  } finally {
    for(const item of clean) await db.execute(item.sql,item.params);
    await db.end();
  }
});
