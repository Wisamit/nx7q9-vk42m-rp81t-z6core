import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {parseClinicalRuleDecimal} from "../src/lib/clinical-rule-decimal.ts";

test("Stage 121 MariaDB: exact clinical DECIMAL(24,8)/(18,6) survive storage, comparison and audit",
  {timeout:90000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const uri=new URL(process.env.DATABASE_URL);
  const config={
    host:uri.hostname,port:Number(uri.port||3306),
    user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
    database:uri.pathname.slice(1),
  };
  const db=await mysql.createConnection(config);
  const org=randomUUID(),branch=randomUUID(),user=randomUUID(),source=randomUUID(),
    target=randomUUID(),reflex=randomUUID(),delta=randomUUID(),suffix=org.slice(0,8);
  const cleanup:Array<{table:string;id:string}>=[];
  async function add(table:string,id:string,sql:string,params:(string|null)[]){
    await db.execute(sql,params);cleanup.unshift({table,id});
  }
  try {
    await add("organizations",org,
      "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"S121"+suffix,"Stage121 synthetic"]);
    await add("branches",branch,
      "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,"S121"+suffix,"Synthetic branch"]);
    await add("users",user,
      "INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [user,org,"stage121"+suffix,"Synthetic rule author"]);
    for(const [id,code]of [[source,"A"],[target,"B"]]){
      await add("lab_tests",id,
        "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,"S121"+suffix+code,"Synthetic clinical test"]);
    }
    const threshold=parseClinicalRuleDecimal("-0.00000001",{precision:24,scale:8})!;
    const absolute=parseClinicalRuleDecimal("0.00000001",{precision:24,scale:8,nonNegative:true})!;
    const percentage=parseClinicalRuleDecimal("0.000001",{precision:18,scale:6,nonNegative:true})!;
    const farThreshold=parseClinicalRuleDecimal("1234567890123456.12345678",{precision:24,scale:8})!;
    await add("reflex_rules",reflex,
      "INSERT INTO reflex_rules(id,organization_id,source_test_id,target_test_id,operator,numeric_threshold,effective_from,status,updated_at) VALUES(?,?,?,?,'LT',?,NOW(3),'INACTIVE',NOW(3))",
      [reflex,org,source,target,threshold]);
    await add("delta_rules",delta,
      "INSERT INTO delta_rules(id,organization_id,test_id,absolute_limit,percent_limit,lookback_days,effective_from,status,updated_at) VALUES(?,?,?,?,?,365,NOW(3),'INACTIVE',NOW(3))",
      [delta,org,source,absolute,percentage]);
    const [row]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT CAST(r.numeric_threshold AS CHAR) AS reflex_value, "+
      "CAST(d.absolute_limit AS CHAR) AS absolute_value, "+
      "CAST(d.percent_limit AS CHAR) AS percent_value "+
      "FROM reflex_rules r JOIN delta_rules d ON d.id=? "+
      "WHERE r.id=? AND r.organization_id=? AND d.organization_id=?",
      [delta,reflex,org,org]);
    assert.equal(row.length,1);
    assert.equal(row[0].reflex_value,threshold);
    assert.equal(row[0].absolute_value,absolute);
    assert.equal(row[0].percent_value,percentage);
    const [math]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT (CAST(? AS DECIMAL(24,8)) < CAST(? AS DECIMAL(24,8))) AS tiny_crossing, "+
      "(CAST(? AS DECIMAL(24,8)) > CAST(? AS DECIMAL(24,8))) AS large_crossing, "+
      "(CAST(? AS DECIMAL(18,6)) > CAST(? AS DECIMAL(18,6))) AS percent_crossing",
      ["-0.00000002",threshold,farThreshold,"1234567890123456.12345677",
        percentage,"0.000000"]);
    assert.equal(Number(math[0].tiny_crossing),1);
    assert.equal(Number(math[0].large_crossing),1);
    assert.equal(Number(math[0].percent_crossing),1);
    const auditId=randomUUID();
    await add("audit_events",auditId,
      "INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'DELTA_RULE_DRAFT_CREATED','DeltaRule',?,?)",
      [auditId,org,branch,user,delta,JSON.stringify({absoluteLimit:absolute,percentLimit:percentage})]);
    const [audits]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT new_values FROM audit_events WHERE id=? AND organization_id=?",[auditId,org]);
    assert.equal(audits.length,1);
    const evidence=typeof audits[0].new_values==="string"
      ?JSON.parse(audits[0].new_values):audits[0].new_values;
    assert.equal(evidence.absoluteLimit,absolute);
    assert.equal(evidence.percentLimit,percentage);
    const [draft]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT status FROM delta_rules WHERE id=?",[delta]);
    assert.equal(draft[0].status,"INACTIVE");
  }finally{
    for(const entry of cleanup){
      await db.execute("DELETE FROM "+entry.table+" WHERE id=?",[entry.id]).catch(()=>{});
    }
    await db.end();
  }
});
