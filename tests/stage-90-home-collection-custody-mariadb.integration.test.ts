import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  homeOrderMatch, homeCollectionStartError, homeCollectionCustodyError,
  type HomeSpecimenEvidence, type HomeFinancialEvidence,
} from "../src/lib/home-collection-custody.ts";

test("Stage 90 MariaDB: order link uniqueness, two-connection custody locks, collection proof, invoice and lab receipt",{
  timeout:75000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const cfg={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1)};
  const [db,competitor]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const id=()=>randomUUID();
  const org=id(),otherOrg=id(),branch=id(),user=id(),patient=id(),
    appointment=id(),visit=id(),otherAppointment=id(),otherVisit=id(),
    order=id(),labTest=id(),item=id(),specimen=id(),invoice=id(),attempt=id(),receipt=id(),
    audit=id(),suffix=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  async function seed(table:string,key:string,sql:string,values:(string|number|null)[]){
    await db.execute(sql,values);cleanup.unshift({table,id:key});
  }
  const rows=async(query:string,args:(string|number|null)[]=[])=>{
    const [r]=await db.execute<mysql.RowDataPacket[]>(query,args);return r;
  };
  try{
    for(const [x,k] of [[org,"A"],[otherOrg,"B"]]){
      await seed("organizations",x,
        "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [x,"S90"+suffix+k,"Home Collection CI"]);
    }
    await seed("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S90"+suffix,"Home Branch"]);
    await seed("users",user,
      "INSERT INTO users(id,organization_id,username,display_name_en,status,updated_at) "+
      "VALUES(?,?,?,?,'ACTIVE',NOW(3))",
      [user,org,"s90"+suffix,"Home Collector"]);
    await seed("patients",patient,
      "INSERT INTO patients(id,organization_id,patient_number,full_name_en,normalized_name,status,updated_at) "+
      "VALUES(?,?,?,?,?,'ACTIVE',NOW(3))",
      [patient,org,"S90"+suffix,"Home Patient","home patient"]);
    for(const [a,v,k] of [[appointment,visit,"A"],[otherAppointment,otherVisit,"B"]]){
      await seed("appointments",a,
        "INSERT INTO appointments(id,organization_id,branch_id,patient_id,appointment_number,mode,service_name_snapshot,scheduled_start,status,updated_at) "+
        "VALUES(?,?,?,?,?,'HOME_COLLECTION','Blood tests',DATE_ADD(NOW(3),INTERVAL 1 DAY),'CONFIRMED',NOW(3))",
        [a,org,branch,patient,"S90"+suffix+k]);
      await seed("home_collection_visits",v,
        "INSERT INTO home_collection_visits(id,appointment_id,branch_id,status,assigned_collector_user_id,updated_at) "+
        "VALUES(?,?,?,'ASSIGNED',?,NOW(3))",
        [v,a,branch,user]);
    }
    await seed("orders",order,
      "INSERT INTO orders(id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,status,updated_at) "+
      "VALUES(?,?,?,?,?,?,'REGISTERED',NOW(3))",
      [order,org,"S90-"+suffix,branch,patient,user]);
    await seed("lab_tests",labTest,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
      [labTest,org,"S90TEST","Home test"]);
    await seed("order_items",item,
      "INSERT INTO order_items(id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) "+
      "VALUES(?,?,?,?,?,'EGP',NOW(3))",
      [item,order,labTest,"S90TEST","Home test"]);
    await seed("specimens",specimen,
      "INSERT INTO specimens(id,organization_id,order_id,barcode,sequence_number,status,current_branch_id,updated_at) "+
      "VALUES(?,?,?,?,1,'COLLECTED',?,NOW(3))",
      [specimen,org,order,"S90-"+suffix+"-01",branch]);
    assert.equal(homeOrderMatch({
      orderOrganizationId:otherOrg,visitOrganizationId:org,
      orderPatientId:patient,visitPatientId:patient,
      orderingBranchId:branch,visitBranchId:branch,orderStatus:"REGISTERED",
      visitStatus:"ASSIGNED",hasSpecimens:true,specimensAllPlanned:true,hasOrderItems:true,alreadyLinked:false,
    }),"home_order_patient_branch_mismatch");
    const [foreign]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM orders WHERE id=? AND organization_id=?",[order,otherOrg]);
    assert.equal(foreign.length,0);
    // Both operator paths lock the appointment before the linked visit and order.
    await db.beginTransaction();
    await db.execute("SELECT id FROM appointments WHERE id=? AND organization_id=? FOR UPDATE",[appointment,org]);
    await db.execute("SELECT id FROM home_collection_visits WHERE id=? FOR UPDATE",[visit]);
    await db.execute("SELECT id FROM orders WHERE id=? AND organization_id=? FOR UPDATE",[order,org]);
    await competitor.query("SET innodb_lock_wait_timeout=1");
    await competitor.beginTransaction();
    let blocked=false;
    try{
      await competitor.execute("UPDATE home_collection_visits SET status='EN_ROUTE' WHERE id=?",[visit]);
    }catch{blocked=true;}
    await competitor.rollback();
    assert.equal(blocked,true,"a concurrent dispatch cannot race order linking");
    const [linked]=await db.execute<mysql.ResultSetHeader>(
      "UPDATE home_collection_visits SET order_id=?,order_linked_by_user_id=?,order_linked_at=NOW(3),updated_at=NOW(3) "+
      "WHERE id=? AND order_id IS NULL AND status='ASSIGNED'",
      [order,user,visit]);
    assert.equal(linked.affectedRows,1);
    await db.execute("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) "+
      "VALUES(?,?,?,?,'HOME_COLLECTION_ORDER_LINKED','HomeCollectionVisit',?,?)",
      [audit,org,branch,user,visit,JSON.stringify({orderId:order})]);
    cleanup.unshift({table:"audit_events",id:audit});
    await db.commit();
    const saved=await rows("SELECT order_id FROM home_collection_visits WHERE id=?",[visit]);
    assert.equal(saved[0].order_id,order);
    await assert.rejects(db.execute(
      "UPDATE home_collection_visits SET order_id=? WHERE id=?",[order,otherVisit]),
      /Duplicate entry|ER_DUP_ENTRY|UNIQUE/i);
    const evidenceVisit={id:visit,orderId:order,branchId:branch,
      assignedCollectorUserId:user,status:"COLLECTING"};
    let invoices:HomeFinancialEvidence[]=[];
    assert.equal(homeCollectionStartError(evidenceVisit,1,invoices),
      "home_issued_invoice_required");
    await seed("invoices",invoice,
      "INSERT INTO invoices(id,organization_id,branch_id,order_id,invoice_number,currency,total,balance_amount,status,created_by_user_id,updated_at) "+
      "VALUES(?,?,?,?,?,'EGP',350,350,'ISSUED',?,NOW(3))",
      [invoice,org,branch,order,"S90INV"+suffix,user]);
    invoices=[{status:"ISSUED",currency:"EGP",total:"350",paidAmount:"0",balanceAmount:"350"}];
    assert.equal(homeCollectionStartError(evidenceVisit,1,invoices),null);
    const specs:HomeSpecimenEvidence[]=[{
      id:specimen,barcode:"S90-"+suffix+"-01",status:"COLLECTED",
      parentRelationType:null,collectionAttempts:[],receptionAssessments:[],
    }];
    assert.equal(homeCollectionCustodyError(evidenceVisit,"COLLECTED",specs,invoices),
      "home_specimen_collection_evidence_missing");
    await seed("specimen_collection_attempts",attempt,
      "INSERT INTO specimen_collection_attempts(id,organization_id,specimen_id,home_collection_visit_id,branch_id,collector_user_id,"+
      "branch_code_snapshot,branch_name_en_snapshot,collector_name_en_snapshot,outcome,patient_name_snapshot,"+
      "patient_number_snapshot,secondary_verification_type,secondary_verification_snapshot,collection_location_type) "+
      "VALUES(?,?,?,?,?,?,?,?,?,'SUCCESS',?,?,'PATIENT_NUMBER',?,'HOME')",
      [attempt,org,specimen,visit,branch,user,"S90"+suffix,"Home Branch","Home Collector","Home Patient","S90"+suffix,"S90"+suffix]);
    specs[0].collectionAttempts=[{outcome:"SUCCESS",homeCollectionVisitId:visit,
      collectionLocationType:"HOME",collectorUserId:user}];
    assert.equal(homeCollectionCustodyError(evidenceVisit,"COLLECTED",specs,invoices),null);
    assert.equal(homeCollectionCustodyError(evidenceVisit,"DELIVERED",specs,invoices),
      "home_specimen_reception_evidence_missing");
    await db.execute("UPDATE specimens SET status='RECEIVED',received_by_user_id=?,received_at=NOW(3) WHERE id=?",
      [user,specimen]);
    await seed("specimen_reception_assessments",receipt,
      "INSERT INTO specimen_reception_assessments(id,organization_id,specimen_id,branch_id,received_by_user_id,barcode_snapshot,label_assessment,condition_code) "+
      "VALUES(?,?,?,?,?,?,'MATCHED','ACCEPTABLE')",
      [receipt,org,specimen,branch,user,"S90"+suffix+"-01"]);
    specs[0].status="RECEIVED";
    specs[0].receptionAssessments=[{branchId:branch}];
    assert.equal(homeCollectionCustodyError(evidenceVisit,"DELIVERED",specs,invoices),null);
    const [custody]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT h.order_id,a.specimen_id,a.outcome,a.home_collection_visit_id,r.branch_id,i.balance_amount "+
      "FROM home_collection_visits h JOIN specimen_collection_attempts a ON a.home_collection_visit_id=h.id "+
      "JOIN specimen_reception_assessments r ON r.specimen_id=a.specimen_id "+
      "JOIN invoices i ON i.order_id=h.order_id WHERE h.id=?",[visit]);
    assert.equal(custody.length,1);
    assert.equal(custody[0].order_id,order);
    assert.equal(custody[0].home_collection_visit_id,visit);
    assert.equal(custody[0].branch_id,branch);
    assert.equal(Number(custody[0].balance_amount),350,"balance preserved (not silently paid)");
  }finally{
    await Promise.all([db.rollback().catch(()=>{}),competitor.rollback().catch(()=>{})]);
    for(const {table,id:key} of cleanup)await db.execute("DELETE FROM "+table+" WHERE id=?",[key]).catch(()=>{});
    await Promise.all([db.end(),competitor.end()]);
  }
});
