import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { paymentPostingFingerprint } from "../src/lib/payment-posting-idempotency.ts";
import { validationSpecimenCustodyError } from "../src/lib/result-validation-custody.ts";

test("Stage 130 MariaDB: shared patient, branch custody, frozen report and invoice, fenced exactly-once settlement", 
  { timeout: 90000 }, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = { host: url.hostname, port: Number(url.port || 3306),
    user: decodeURIComponent(url.username), password: decodeURIComponent(url.password),
    database: url.pathname.slice(1) };
  const [db, first, competing] = await Promise.all([
    mysql.createConnection(config), mysql.createConnection(config), mysql.createConnection(config)]);
  const ids = {
    org: randomUUID(), foreignOrg: randomUUID(), a: randomUUID(), b: randomUUID(),
    actor: randomUUID(), patient: randomUUID(), test: randomUUID(), order: randomUUID(),
    secondOrder: randomUUID(), item: randomUUID(), invoice: randomUUID(), line: randomUUID(),
    method: randomUUID(), shift: randomUUID(), specimen: randomUUID(), manifest: randomUUID(),
    result: randomUUID(), report: randomUUID(), version: randomUUID(), payment: randomUUID(),
    key: randomUUID(), audit: randomUUID(),
  };
  const suffix = ids.org.slice(0, 8);
  const cleanup: Array<{ sql: string; params: Array<string | number> }> = [];
  async function put(sql: string, params: Array<string | number>, undo: string, undoParams: Array<string | number>) {
    await db.execute(sql, params);
    cleanup.unshift({ sql: undo, params: undoParams });
  }
  try {
    await put("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [ids.org,"S130"+suffix,"Synthetic 130"], "DELETE FROM organizations WHERE id=?", [ids.org]);
    await put("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [ids.foreignOrg,"F130"+suffix,"Synthetic foreign"], "DELETE FROM organizations WHERE id=?", [ids.foreignOrg]);
    for (const [branch, code] of [[ids.a,"A"],[ids.b,"B"]]) await put(
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,ids.org,"S130"+suffix+code,"Synthetic Branch "+code],
      "DELETE FROM branches WHERE id=?", [branch]);
    await put("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [ids.actor,ids.org,"stage130"+suffix,"Synthetic operator"],"DELETE FROM users WHERE id=?", [ids.actor]);
    await put("INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [ids.patient,ids.org,"S130"+suffix,"Synthetic Patient","synthetic patient"],
      "DELETE FROM patients WHERE id=?", [ids.patient]);
    await put("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [ids.test,ids.org,"S130"+suffix,"Initial test display"],"DELETE FROM lab_tests WHERE id=?", [ids.test]);
    for (const [order,branch,code] of [[ids.order,ids.a,"A"],[ids.secondOrder,ids.b,"B"]]) await put(
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [order,ids.org,"S130"+suffix+code,branch,ids.patient,ids.actor],
      "DELETE FROM orders WHERE id=?", [order]);
    await put("INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,final_price_snapshot,currency,updated_at) VALUES(?,?,?,?,?,200.5000,'AED',NOW(3))",
      [ids.item,ids.order,ids.test,"S130","Initial test display"],
      "DELETE FROM order_items WHERE id=?", [ids.item]);
    await put("INSERT INTO invoices(id,organization_id,branch_id,order_id,invoice_number,currency,total,balance_amount,created_by_user_id,updated_at) VALUES(?,?,?,?,?,'AED',200.5000,200.5000,?,NOW(3))",
      [ids.invoice,ids.org,ids.a,ids.order,"S130INV"+suffix,ids.actor],
      "DELETE FROM invoices WHERE id=?", [ids.invoice]);
    await put("INSERT INTO invoice_lines(id,invoice_id,order_item_id,description,unit_price,line_total) VALUES(?,?,?,'Initial test display',200.5000,200.5000)",
      [ids.line,ids.invoice,ids.item],"DELETE FROM invoice_lines WHERE id=?", [ids.line]);
    await put("INSERT INTO payment_method_configs(id,organization_id,code,name_en,base_method,updated_at) VALUES(?,?,?,'Synthetic Cash','CASH',NOW(3))",
      [ids.method,ids.org,"S130CASH"+suffix],"DELETE FROM payment_method_configs WHERE id=?", [ids.method]);
    await put("INSERT INTO cashier_shifts(id,organization_id,branch_id,cashier_user_id,shift_number,currency,opening_cash,updated_at) VALUES(?,?,?,?,?,'AED',0,NOW(3))",
      [ids.shift,ids.org,ids.a,ids.actor,"S130SHIFT"+suffix],
      "DELETE FROM cashier_shifts WHERE id=?", [ids.shift]);

    await put("INSERT INTO specimens(id,organization_id,order_id,barcode,sequence_number,status,collection_branch_id,current_branch_id,updated_at) VALUES(?,?,?,?,1,'RECEIVED',?,?,NOW(3))",
      [ids.specimen,ids.org,ids.order,"S130BC"+suffix,ids.a,ids.b],
      "DELETE FROM specimens WHERE id=?", [ids.specimen]);
    await put("INSERT INTO specimen_transfer_manifests(id,organization_id,manifest_number,source_branch_id,destination_branch_id,status,created_by_user_id,updated_at) VALUES(?,?,?,?,?,'RECEIVED',?,NOW(3))",
      [ids.manifest,ids.org,"S130MAN"+suffix,ids.a,ids.b,ids.actor],
      "DELETE FROM specimen_transfer_manifests WHERE id=?", [ids.manifest]);
    await put("INSERT INTO specimen_transfer_items(manifest_id,specimen_id,barcode_snapshot,status) VALUES(?,?,?,'RECEIVED')",
      [ids.manifest,ids.specimen,"S130BC"+suffix],
      "DELETE FROM specimen_transfer_items WHERE manifest_id=? AND specimen_id=?", [ids.manifest,ids.specimen]);
    await put("INSERT INTO laboratory_results(id,organization_id,order_item_id,specimen_id,performing_branch_id,entered_by_user_id,status,validation_stage,version,updated_at) VALUES(?,?,?,?,?,?,'RELEASED','COMPLETE',1,NOW(3))",
      [ids.result,ids.org,ids.item,ids.specimen,ids.b,ids.actor],
      "DELETE FROM laboratory_results WHERE id=?", [ids.result]);
    await put("INSERT INTO diagnostic_reports(id,organization_id,order_id,updated_at) VALUES(?,?,?,NOW(3))",
      [ids.report,ids.org,ids.order], "DELETE FROM diagnostic_reports WHERE id=?", [ids.report]);
    const originalSnapshot = JSON.stringify({testNameEn:"Initial test display",amount:"200.5000",currency:"AED",specimenBarcode:"S130BC"+suffix,performingBranchId:ids.b});
    await put("INSERT INTO diagnostic_report_versions(id,report_id,version,status,branch_id,content_snapshot,result_version_snapshot,verification_token,issued_by_user_id) VALUES(?,?,1,'FINAL',?,?,?, ?,?)",
      [ids.version,ids.report,ids.a,originalSnapshot,JSON.stringify([{resultId:ids.result,version:1}]),"S130V"+suffix,ids.actor],
      "DELETE FROM diagnostic_report_versions WHERE id=?", [ids.version]);

    const [trace] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT o.patient_id,o.ordering_branch_id,s.collection_branch_id,s.current_branch_id,r.performing_branch_id,m.destination_branch_id FROM orders o JOIN specimens s ON s.order_id=o.id JOIN laboratory_results r ON r.specimen_id=s.id JOIN specimen_transfer_items ti ON ti.specimen_id=s.id JOIN specimen_transfer_manifests m ON m.id=ti.manifest_id WHERE o.id=? AND o.organization_id=?",
      [ids.order,ids.org]);
    assert.equal(trace.length,1);
    assert.equal(trace[0].patient_id,ids.patient);
    assert.equal(trace[0].ordering_branch_id,ids.a);
    assert.equal(trace[0].current_branch_id,ids.b);
    assert.equal(trace[0].performing_branch_id,ids.b);
    assert.equal(trace[0].destination_branch_id,ids.b);
    const [history] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT ordering_branch_id FROM orders WHERE organization_id=? AND patient_id=? ORDER BY accession_number",
      [ids.org,ids.patient]);
    assert.equal(history.length,2,"one patient identity reused across branches");
    const [denied] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM diagnostic_reports WHERE id=? AND organization_id=?",
      [ids.report,ids.foreignOrg]);
    assert.equal(denied.length,0,"cross-tenant report must never appear in scoped query");
    const [wrongBranch] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM laboratory_results WHERE id=? AND performing_branch_id=?",
      [ids.result,ids.a]);
    assert.equal(wrongBranch.length,0,"ordered-at branch cannot masquerade as performing branch");

    const fingerprint=paymentPostingFingerprint({kind:"INVOICE",organizationId:ids.org,actorUserId:ids.actor,
      paymentMethodId:ids.method,legacyMethod:"",reference:"synthetic",amount:"75.125",
      allocations:[{invoiceId:ids.invoice,amount:"75.1250"}]});
    assert.equal(fingerprint.length,64);
    await first.beginTransaction();
    const [claim]=await first.execute<mysql.ResultSetHeader>(
      "UPDATE invoices SET paid_amount=75.1250,balance_amount=125.3750,status='PARTIALLY_PAID' WHERE id=? AND organization_id=? AND paid_amount=0 AND balance_amount=200.5000",
      [ids.invoice,ids.org]);
    assert.equal(claim.affectedRows,1);
    await competing.query("SET SESSION innodb_lock_wait_timeout=1");
    await competing.beginTransaction();
    await assert.rejects(
      competing.execute("UPDATE invoices SET paid_amount=75.1250 WHERE id=? AND paid_amount=0",[ids.invoice]),
      (e:unknown)=>Boolean(e && typeof e==="object" && "code" in e && e.code==="ER_LOCK_WAIT_TIMEOUT"));
    await competing.rollback();
    const snapshot=JSON.stringify({status:"ok",paymentId:ids.payment,invoiceNumber:"S130INV"+suffix,
      paidAmount:"75.1250",balanceAmount:"125.3750",invoiceStatus:"PARTIALLY_PAID"});
    await first.execute(
      "INSERT INTO payments(id,organization_id,branch_id,amount,currency,method,payment_method_config_id,payment_method_code_snapshot,payment_method_name_en_snapshot,cashier_user_id,cashier_shift_id,posting_key,posting_fingerprint,posting_response_snapshot,reference) VALUES(?,?,?,75.1250,'AED','CASH',?,?,?, ?,?,?,?,?,?)",
      [ids.payment,ids.org,ids.a,ids.method,"S130CASH"+suffix,"Synthetic Cash",ids.actor,ids.shift,ids.key,fingerprint,snapshot,"synthetic"]);
    cleanup.unshift({sql:"DELETE FROM payments WHERE id=?",params:[ids.payment]});
    await first.execute("INSERT INTO payment_allocations(payment_id,invoice_id,amount) VALUES(?,?,75.1250)",
      [ids.payment,ids.invoice]);
    cleanup.unshift({sql:"DELETE FROM payment_allocations WHERE payment_id=?",params:[ids.payment]});
    await first.execute("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id) VALUES(?,?,?,?,'PAYMENT_POSTED','Payment',?)",
      [ids.audit,ids.org,ids.a,ids.actor,ids.payment]);
    cleanup.unshift({sql:"DELETE FROM audit_events WHERE id=?",params:[ids.audit]});
    await first.commit();

    await assert.rejects(
      competing.execute("INSERT INTO payments(id,organization_id,branch_id,amount,currency,method,payment_method_config_id,payment_method_code_snapshot,payment_method_name_en_snapshot,cashier_user_id,posting_key,posting_fingerprint) VALUES(?,?,?,75.1250,'AED','CASH',?,?,?, ?,?,?)",
        [randomUUID(),ids.org,ids.a,ids.method,"S130CASH"+suffix,"Synthetic Cash",ids.actor,ids.key,fingerprint]),
      (e:unknown)=>Boolean(e && typeof e==="object" && "code" in e && e.code==="ER_DUP_ENTRY"),
      "one tenant-scoped replay key cannot create a second settlement");
    const [posted] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT i.paid_amount,i.balance_amount,i.currency,COUNT(pa.payment_id) AS n FROM invoices i LEFT JOIN payment_allocations pa ON pa.invoice_id=i.id WHERE i.id=? GROUP BY i.id",
      [ids.invoice]);
    assert.equal(posted[0].paid_amount,"75.1250");
    assert.equal(posted[0].balance_amount,"125.3750");
    assert.equal(posted[0].currency,"AED");
    assert.equal(Number(posted[0].n),1);
    const [audit] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_events WHERE entity_id=? AND action='PAYMENT_POSTED'",[ids.payment]);
    assert.equal(Number(audit[0].n),1);
    await db.execute("UPDATE lab_tests SET name_en='Changed future catalog label' WHERE id=?",[ids.test]);
    const [frozen] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT oi.test_name_en_snapshot,il.line_total,v.content_snapshot FROM order_items oi JOIN invoice_lines il ON il.order_item_id=oi.id JOIN diagnostic_reports r ON r.order_id=oi.order_id JOIN diagnostic_report_versions v ON v.report_id=r.id WHERE oi.id=?",
      [ids.item]);
    assert.equal(frozen[0].test_name_en_snapshot,"Initial test display");
    assert.equal(frozen[0].line_total,"200.5000");
    const content=typeof frozen[0].content_snapshot==="string"
      ? JSON.parse(frozen[0].content_snapshot):frozen[0].content_snapshot;
    assert.deepEqual(content,JSON.parse(originalSnapshot));

    // Report release must not rely on a custody state captured by earlier
    // technical or medical review; the source may move before final issue.
    assert.equal(validationSpecimenCustodyError({
      status:"RECEIVED",currentBranchId:ids.b,performingBranchId:ids.b,
    }),null);
    await first.beginTransaction();
    const [moved] = await first.execute<mysql.ResultSetHeader>(
      "UPDATE specimens SET status='IN_TRANSIT',current_branch_id=?,preanalytical_version=preanalytical_version+1 WHERE id=? AND current_branch_id=? AND status='RECEIVED'",
      [ids.a,ids.specimen,ids.b]);
    assert.equal(moved.affectedRows,1);
    await competing.beginTransaction();
    await assert.rejects(
      competing.execute("SELECT id,status,current_branch_id FROM specimens WHERE id=? FOR UPDATE",[ids.specimen]),
      (e:unknown)=>Boolean(e && typeof e==="object" && "code" in e && e.code==="ER_LOCK_WAIT_TIMEOUT"));
    await competing.rollback();
    await first.commit();
    const [live] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT status,current_branch_id FROM specimens WHERE id=? AND organization_id=?",[ids.specimen,ids.org]);
    assert.equal(validationSpecimenCustodyError({
      status:live[0].status,currentBranchId:live[0].current_branch_id,
      performingBranchId:ids.b,
    }),"specimen_not_ready_for_validation");
    const [frozenAgain] = await db.execute<mysql.RowDataPacket[]>(
      "SELECT content_snapshot FROM diagnostic_report_versions WHERE id=?",[ids.version]);
    const prior=typeof frozenAgain[0].content_snapshot==="string"
      ? JSON.parse(frozenAgain[0].content_snapshot):frozenAgain[0].content_snapshot;
    assert.deepEqual(prior,JSON.parse(originalSnapshot),"released version remains unchanged by later custody");

  } finally {
    await Promise.all([first.rollback().catch(()=>{}),competing.rollback().catch(()=>{})]);
    for(const c of cleanup) await db.execute(c.sql,c.params).catch(()=>{});
    await Promise.all([first.end(),competing.end(),db.end()]);
  }
});
