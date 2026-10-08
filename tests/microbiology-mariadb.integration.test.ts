import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";

/** Real InnoDB custody/case locks, isolate sequence and AST DECIMAL snapshot. */
test("MariaDB serializes microbiology isolates and preserves exact AST measurements", { timeout: 30000 }, async () => {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required for MariaDB microbiology integration");
  const uri=new URL(process.env.DATABASE_URL);
  const config={
    host:uri.hostname,port:Number(uri.port||3306),database:uri.pathname.slice(1),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
  };
  const [setup,first,second]=await Promise.all([
    mysql.createConnection(config),mysql.createConnection(config),mysql.createConnection(config),
  ]);
  const org=randomUUID(),branch=randomUUID(),user=randomUUID(),patient=randomUUID();
  const order=randomUUID(),testId=randomUUID(),item=randomUUID(),specimen=randomUUID();
  const microCase=randomUUID(),organism=randomUUID(),antibiotic=randomUUID();
  const isolateOne=randomUUID(),isolateTwo=randomUUID(),astTest=randomUUID(),astResult=randomUUID();
  const suffix=org.slice(0,8);
  const cleanup: Array<{sql:string;args:string[]}>=[];

  async function seed(sql:string,args:string[],undoSql:string,undoArgs:string[]) {
    await setup.execute(sql,args);
    cleanup.unshift({sql:undoSql,args:undoArgs});
  }

  try {
    await seed("INSERT INTO organizations (id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
      [org,"MB-"+suffix,"Microbiology CI"],"DELETE FROM organizations WHERE id = ?",[org]);
    await seed("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [branch,org,"MB-"+suffix,"Microbiology Branch"],"DELETE FROM branches WHERE id = ?",[branch]);
    await seed("INSERT INTO users (id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [user,org,"mb-"+suffix,"Microbiology Reviewer"],"DELETE FROM users WHERE id = ?",[user]);
    await seed("INSERT INTO patients (id,organization_id,patient_number,full_name_en,normalized_name,updated_at) VALUES (?,?,?,?,?,NOW(3))",
      [patient,org,"MB-"+suffix,"Microbiology Patient","microbiology patient"],"DELETE FROM patients WHERE id = ?",[patient]);
    await seed("INSERT INTO orders (id,organization_id,accession_number,ordering_branch_id,patient_id,created_by_user_id,updated_at) VALUES (?,?,?,?,?,?,NOW(3))",
      [order,org,"MB-"+suffix,branch,patient,user],"DELETE FROM orders WHERE id = ?",[order]);
    await seed("INSERT INTO lab_tests (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [testId,org,"MB-"+suffix,"Culture CI"],"DELETE FROM lab_tests WHERE id = ?",[testId]);
    await seed("INSERT INTO order_items (id,order_id,test_id,test_code_snapshot,test_name_en_snapshot,currency,updated_at) VALUES (?,?,?,?,?,'USD',NOW(3))",
      [item,order,testId,"MB-"+suffix,"Culture CI"],"DELETE FROM order_items WHERE id = ?",[item]);
    await seed("INSERT INTO specimens (id,organization_id,order_id,barcode,sequence_number,status,current_branch_id,updated_at) VALUES (?,?,?,?,1,'IN_PROCESS',?,NOW(3))",
      [specimen,org,order,"MICRO-"+suffix,branch],"DELETE FROM specimens WHERE id = ?",[specimen]);
    await seed("INSERT INTO microbiology_cases (id,organization_id,order_item_id,specimen_id,performing_branch_id,status,culture_status,created_by_user_id,updated_at) VALUES (?,?,?,?,?,'IN_PROGRESS','PENDING',?,NOW(3))",
      [microCase,org,item,specimen,branch,user],"DELETE FROM microbiology_cases WHERE id = ?",[microCase]);
    await seed("INSERT INTO organisms (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [organism,org,"MB-"+suffix,"Test organism"],"DELETE FROM organisms WHERE id = ?",[organism]);
    await seed("INSERT INTO antibiotics (id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
      [antibiotic,org,"AB-"+suffix,"Test antibiotic"],"DELETE FROM antibiotics WHERE id = ?",[antibiotic]);

    const [snapshot]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT updated_at FROM microbiology_cases WHERE id = ?",[microCase]);
    const originalRevision=(snapshot[0]?.updated_at as Date).getTime();

    await first.beginTransaction();
    const [custody]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,current_branch_id FROM specimens WHERE id = ? AND organization_id = ? FOR UPDATE",[specimen,org]);
    assert.equal(custody[0]?.status,"IN_PROCESS");
    assert.equal(custody[0]?.current_branch_id,branch);
    const [caseRows]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT id,status,result_id,updated_at FROM microbiology_cases WHERE id = ? AND organization_id = ? FOR UPDATE",[microCase,org]);
    assert.equal(caseRows.length,1);
    assert.equal(caseRows[0]?.result_id,null);
    assert.equal((caseRows[0]?.updated_at as Date).getTime(),originalRevision);

    await second.query("SET SESSION innodb_lock_wait_timeout = 1");
    await second.beginTransaction();
    await assert.rejects(
      second.execute("SELECT id FROM specimens WHERE id = ? FOR UPDATE",[specimen]),
      (err:unknown)=>Boolean(err && typeof err==="object" && "code" in err && err.code==="ER_LOCK_WAIT_TIMEOUT"));
    await second.rollback();

    const [last]=await first.execute<mysql.RowDataPacket[]>(
      "SELECT MAX(sequence_number) AS seq FROM microbiology_isolates WHERE case_id = ?",[microCase]);
    assert.equal(last[0]?.seq,null);
    await first.execute("INSERT INTO microbiology_isolates (id,case_id,organism_id,sequence_number,updated_at) VALUES (?,?,?,?,NOW(3))",
      [isolateOne,microCase,organism,1]);
    cleanup.unshift({sql:"DELETE FROM microbiology_isolates WHERE id = ?",args:[isolateOne]});
    await first.execute(
      "UPDATE microbiology_cases SET culture_status = 'GROWTH',updated_at = DATE_ADD(updated_at,INTERVAL 1 SECOND) WHERE id = ?",
      [microCase]);
    await first.commit();

    await second.beginTransaction();
    const [ready]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT id,status FROM specimens WHERE id = ? FOR UPDATE",[specimen]);
    assert.equal(ready[0]?.status,"IN_PROCESS");
    const [caseAgain]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT updated_at,result_id FROM microbiology_cases WHERE id = ? FOR UPDATE",[microCase]);
    assert.notEqual((caseAgain[0]?.updated_at as Date).getTime(),originalRevision);
    const [isolateLast]=await second.execute<mysql.RowDataPacket[]>(
      "SELECT MAX(sequence_number) AS seq FROM microbiology_isolates WHERE case_id = ?",[microCase]);
    assert.equal(Number(isolateLast[0]?.seq),1);
    await second.execute("INSERT INTO microbiology_isolates (id,case_id,organism_id,sequence_number,updated_at) VALUES (?,?,?,?,NOW(3))",
      [isolateTwo,microCase,organism,2]);
    cleanup.unshift({sql:"DELETE FROM microbiology_isolates WHERE id = ?",args:[isolateTwo]});
    await second.commit();

    await seed("INSERT INTO susceptibility_tests (id,isolate_id,method,entered_by_user_id,updated_at) VALUES (?,?,'MIC',?,NOW(3))",
      [astTest,isolateTwo,user],"DELETE FROM susceptibility_tests WHERE id = ?",[astTest]);
    await seed(`INSERT INTO susceptibility_results
      (id,susceptibility_test_id,antibiotic_id,antibiotic_code_snapshot,antibiotic_name_en_snapshot,interpretation,mic_value,mic_unit,zone_diameter_mm,breakpoint_snapshot,updated_at)
      VALUES (?,?,?,?,?,'UNKNOWN',?,'mg/L',?,? ,NOW(3))`,
      [astResult,astTest,antibiotic,"AB-"+suffix,"Test antibiotic","0.000125","12.375","Manual AST, no automatic breakpoint inference"],
      "DELETE FROM susceptibility_results WHERE id = ?",[astResult]);
    const [ast]=await setup.execute<mysql.RowDataPacket[]>(
      "SELECT CAST(mic_value AS CHAR) AS mic,CAST(zone_diameter_mm AS CHAR) AS zone,interpretation,breakpoint_snapshot FROM susceptibility_results WHERE id = ?",[astResult]);
    assert.equal(ast[0]?.mic,"0.000125");
    assert.equal(ast[0]?.zone,"12.375");
    assert.equal(ast[0]?.interpretation,"UNKNOWN");
    assert.equal(ast[0]?.breakpoint_snapshot,"Manual AST, no automatic breakpoint inference");
  } finally {
    await Promise.all([first.rollback().catch(()=>{}),second.rollback().catch(()=>{})]);
    for(const item of cleanup) await setup.execute(item.sql,item.args);
    await Promise.all([setup.end(),first.end(),second.end()]);
  }
});
