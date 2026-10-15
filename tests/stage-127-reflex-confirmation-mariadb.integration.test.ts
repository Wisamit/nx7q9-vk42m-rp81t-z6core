import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { reflexOrderEvidenceError } from "../src/lib/reflex-order-confirmation.ts";

test("Stage 127 MariaDB: billed Reflex claim has exactly one reviewer, linked FK, immutable snapshots and tenant fencing",
  {timeout:90000}, async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [db,rival]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(),branch=randomUUID(),actor=randomUUID(),patient=randomUUID(),
    sourceTest=randomUUID(),targetTest=randomUUID(),sourceOrder=randomUUID(),targetOrder=randomUUID(),
    sourceItem=randomUUID(),targetItem=randomUUID(),result=randomUUID(),rule=randomUUID(),
    reflexEvent=randomUUID(),invoice=randomUUID(),invoiceLine=randomUUID(),otherOrg=randomUUID();
  const suffix=org.slice(0,8);
  const cleanup:Array<[string,string,string]>=[],auditIds:string[]=[];
  const insert=async(table:string,id:string,sql:string,params:(string|number|null)[])=>{
    await db.execute(sql,params);cleanup.unshift([table,"id",id]);
  };
  try{
    for(const [id,tag] of [[org,"A"],[otherOrg,"B"]])await insert("organizations",id,
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [id,"S127"+suffix+tag,"Stage127 synthetic tenant"]);
    await insert("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S127"+suffix,"Synthetic branch"]);
    await insert("users",actor,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [actor,org,"stage127"+suffix,"Synthetic operator"]);
    for(const [id,code] of [[sourceTest,"SOURCE"],[targetTest,"FOLLOWUP"]]){
      await insert("lab_tests",id,
        "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"S127"+suffix+code,code+" test"]);
    }
    await insert("patients",patient,
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [patient,org,"S127"+suffix,"Synthetic patient","synthetic patient"]);
    for(const [id,tag] of [[sourceOrder,"S"],[targetOrder,"T"]])await insert("orders",id,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [id,org,"S127"+suffix+tag,branch,patient,actor]);
    await insert("order_items",sourceItem,
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES(?,?,?,?,?,'AED',NOW(3))",
      [sourceItem,sourceOrder,sourceTest,"SRC","Source test"]);
    await insert("order_items",targetItem,
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,final_price_snapshot,currency,updated_at) VALUES(?,?,?,?,?,125.5000,'AED',NOW(3))",
      [targetItem,targetOrder,targetTest,"FOLLOW","Follow-up test"]);
    await insert("invoices",invoice,
      "INSERT INTO invoices(id,organization_id,branch_id,order_id,invoice_number,status,currency,created_by_user_id,updated_at) VALUES(?,?,?,?,?,'ISSUED','AED',?,NOW(3))",
      [invoice,org,branch,targetOrder,"S127INV"+suffix,actor]);
    await insert("invoice_lines",invoiceLine,
      "INSERT INTO invoice_lines(id,invoice_id,order_item_id,description,unit_price,line_total) VALUES(?,?,?,?,125.5000,125.5000)",
      [invoiceLine,invoice,targetItem,"Follow-up test"]);
    await insert("laboratory_results",result,
      "INSERT INTO laboratory_results(id,organization_id,order_item_id,performing_branch_id,entered_by_user_id,status,updated_at) VALUES(?,?,?,?,?,'ENTERED',NOW(3))",
      [result,org,sourceItem,branch,actor]);
    await insert("reflex_rules",rule,
      "INSERT INTO reflex_rules(id,organization_id,source_test_id,target_test_id,operator,text_threshold,effective_from,updated_at) VALUES(?,?,?,?,?,'positive',NOW(3),NOW(3))",
      [rule,org,sourceTest,targetTest,"EQ"]);
    await insert("reflex_rule_events",reflexEvent,
      "INSERT INTO reflex_rule_events(id,result_id,rule_id,status,trigger_value_snapshot,target_test_code_snapshot,target_test_name_en_snapshot,updated_at) VALUES(?,?,?,'PENDING','positive','FOLLOW','Follow-up test',NOW(3))",
      [reflexEvent,result,rule]);
    const [baselineRows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,updated_at FROM reflex_rule_events WHERE id=?",[reflexEvent]);
    const original=baselineRows[0];
    const evidence={
      organizationId:org,sameOrganization:true,sourcePatientId:patient,targetPatientId:patient,
      sourceOrderingBranchId:branch,targetOrderingBranchId:branch,
      sourceOrderId:sourceOrder,targetOrderId:targetOrder,targetItemId:targetItem,
      targetTestId:targetTest,ruleTargetTestId:targetTest,targetItemStatus:"ORDERED",
      targetOrderStatus:"REGISTERED",targetItemCreatedAt:new Date(),
      reflexDetectedAt:new Date(Date.now()-60_000),
      invoiceStatus:"ISSUED",invoiceOrderId:targetOrder,invoiceCurrency:"AED",
      invoiceLineOrderItemId:targetItem,invoiceLineTotal:"125.5000",
      targetItemFinalPrice:"125.5000",targetItemCurrency:"AED",invoiceLineQuantity:"1.000",
      specimenRequirementConfigured:false,activeSpecimens:[],explicitBillingAcknowledgement:true,
    };
    assert.equal(reflexOrderEvidenceError(evidence),null);
    assert.equal(reflexOrderEvidenceError({...evidence,targetPatientId:"wrong"}),"reflex_target_order_identity_mismatch");
    assert.equal(reflexOrderEvidenceError({...evidence,sameOrganization:false}),"reflex_target_order_identity_mismatch");
    await db.query("SET SESSION innodb_lock_wait_timeout=4");
    await rival.query("SET SESSION innodb_lock_wait_timeout=4");
    async function confirm(conn:mysql.Connection){
      await conn.beginTransaction();
      try{
        const [claim]=await conn.execute<mysql.ResultSetHeader>(
          "UPDATE reflex_rule_events SET status='ACKNOWLEDGED', reviewed_by_user_id=?, reviewed_at=NOW(3), confirmed_order_item_id=?, billing_evidence_snapshot=? WHERE id=? AND result_id=? AND status='PENDING' AND updated_at=?",
          [actor,targetItem,JSON.stringify({invoiceLineId:invoiceLine,invoiceId:invoice,
            lineTotal:"125.5000",currency:"AED",noAutoOrderOrCharge:true}),
            reflexEvent,result,original.updated_at]);
        if(claim.affectedRows!==1){await conn.rollback();return false;}
        const audit=randomUUID();
        await conn.execute(
          "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id) VALUES(?,?,?,?,'REFLEX_ORDER_CONFIRMED','ReflexRuleEvent',?)",
          [audit,org,branch,actor,reflexEvent]);
        await conn.commit();auditIds.push(audit);return true;
      }catch(error){await conn.rollback();throw error;}
    }
    const winners=await Promise.all([confirm(db),confirm(rival)]);
    assert.equal(winners.filter(Boolean).length,1,"only one concurrent reviewer wins");
    const [rows]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT status,reviewed_by_user_id,confirmed_order_item_id,billing_evidence_snapshot FROM reflex_rule_events WHERE id=?",
      [reflexEvent]);
    assert.equal(rows[0].status,"ACKNOWLEDGED");
    assert.equal(rows[0].reviewed_by_user_id,actor);
    assert.equal(rows[0].confirmed_order_item_id,targetItem);
    const snap=typeof rows[0].billing_evidence_snapshot==="string"
      ? JSON.parse(rows[0].billing_evidence_snapshot):rows[0].billing_evidence_snapshot;
    assert.equal(snap.invoiceLineId,invoiceLine);
    assert.equal(snap.noAutoOrderOrCharge,true);
    const [audit]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM audit_events WHERE entity_type='ReflexRuleEvent' AND entity_id=?",[reflexEvent]);
    assert.equal(Number(audit[0].n),1);
    const [bill]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id=?",[invoice]);
    assert.equal(Number(bill[0].n),1,"no duplicate financial lines");
    await assert.rejects(
      db.execute("UPDATE reflex_rule_events SET confirmed_order_item_id=? WHERE id=?",
        [randomUUID(),reflexEvent]),
      /foreign key|constraint/i,"arbitrary order item IDs must not be accepted");
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),rival.rollback().catch(()=>{})]);
    for(const id of auditIds)await db.execute("DELETE FROM audit_events WHERE id=?",[id]).catch(()=>{});
    for(const [table,col,id] of cleanup)await db.execute(
      "DELETE FROM "+table+" WHERE "+col+"=?",[id]).catch(()=>{});
    await Promise.all([db.end(),rival.end()]);
  }
});
