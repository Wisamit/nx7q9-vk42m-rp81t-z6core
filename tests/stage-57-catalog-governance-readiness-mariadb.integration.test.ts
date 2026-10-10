import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { catalogDriftObservationToken } from "../src/lib/catalog-drift-triage.ts";
import { resolveFindingLifecycle } from "../src/lib/catalog-finding-lifecycle.ts";
import { summarizeCatalogGovernance } from "../src/lib/catalog-governance-readiness.ts";

test("Stage 57 MariaDB: independent sessions yield stale review count, block signoff, and preserve masters",
{timeout:45000}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const cfg = {host:url.hostname,port:Number(url.port||3306),user:decodeURIComponent(url.username),
    password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const [author, reviewer] = await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
  const org=randomUUID(), foreign=randomUUID(), branch=randomUUID();
  const authorId=randomUUID(), reviewerId=randomUUID(), testId=randomUUID(), foreignTest=randomUUID();
  const batch=randomUUID(),rowId=randomUUID(),flag=randomUUID(),decision=randomUUID();
  const prefix="S57"+org.slice(0,8), key="stage-57-test-only-signing-secret-not-production";
  const checksum="f".repeat(64);
  const source={id:testId,code:prefix+"T",nameEn:"Original"};
  const old={...source};
  const first=catalogDriftObservationToken(key,checksum,1,"TEST",source,old);
  const exec=(sql:string,values:Array<string|number|null>)=>author.execute(sql,values);
  try {
    for(const [id,suffix] of [[org,"A"],[foreign,"F"]])
      await exec("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,prefix+suffix,"Stage 57 Tenant"]);
    await exec("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,prefix+"B","Stage 57 Branch"]);
    for(const [id,tenant,suffix] of [[testId,org,"T"],[foreignTest,foreign,"F"]])
      await exec("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,tenant,prefix+suffix,"Original"]);
    for(const [id,suffix] of [[authorId,"A"],[reviewerId,"R"]])
      await exec("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+suffix,"Stage 57 Reviewer"]);
    await exec("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','stage57.json',?,'DRAFT',?,NOW(3))",
      [batch,org,checksum,authorId]);
    await exec("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES(?,?,1,'TEST','WARNING',?,?,NOW(3))",
      [rowId,batch,JSON.stringify(source),JSON.stringify(source)]);
    await exec("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_EXPERT_REVIEW_FLAGGED','CatalogImportRow',?,?)",
      [flag,org,branch,authorId,rowId,JSON.stringify({
        batchId:batch,rowNumber:1,entityType:"TEST",category:"CLINICAL",
        reasonCode:"REQUIRES_DOMAIN_ASSESSMENT",evidenceToken:first,
        approved:false,activated:false,reviewOnly:true,
      })]);
    await exec("INSERT INTO audit_events(id,organization_id,branch_id,actor_user_id,action,entity_type,entity_id,new_values) VALUES(?,?,?,?,'CATALOG_BUNDLE_EXPERT_DECISION_RECORDED','CatalogExpertReviewFlag',?,?)",
      [decision,org,branch,reviewerId,flag,JSON.stringify({
        batchId:batch,rowId,disposition:"CONFIRM_FINDING",category:"CLINICAL",
        evidenceToken:first,approved:false,activated:false,reviewOnly:true,
      })]);

    const initial=summarizeCatalogGovernance([
      {entityType:"TEST",disposition:"UNCHANGED",finding:resolveFindingLifecycle({
        evidenceToken:first,currentObservation:first,decision:"CONFIRM_FINDING",
      })},
    ],true);
    assert.equal(initial.byCategory.CLINICAL.expertConfirmed,1);
    assert.equal(initial.approved,false);
    assert.equal(initial.activationAllowed,false);

    // Writer completes FK-related changes before the second connection waits
    // on the same tenant lock. No synthetic FK/deadlock inversion.
    await author.beginTransaction();
    const [locked]=await author.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    assert.equal(locked.length,1);
    await author.execute("UPDATE lab_tests SET name_en='New active value' WHERE id=?",[testId]);
    await reviewer.beginTransaction();
    const waiting=reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",[org]);
    await author.commit();
    const [acquired]=await waiting;
    assert.equal(acquired.length,1);
    const [current]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id,code,name_en FROM lab_tests WHERE id=? AND organization_id=?",[testId,org]);
    assert.equal(current.length,1);
    const live={id:String(current[0].id),code:String(current[0].code),nameEn:String(current[0].name_en)};
    const latest=catalogDriftObservationToken(key,checksum,1,"TEST",source,live);
    const [flagged]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT new_values FROM audit_events WHERE id=? AND organization_id=?",[flag,org]);
    assert.equal(flagged.length,1);
    const evidence=typeof flagged[0].new_values==="string"?
      JSON.parse(flagged[0].new_values):flagged[0].new_values;
    const [signedOff]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT new_values FROM audit_events WHERE id=? AND organization_id=?",[decision,org]);
    const recorded=typeof signedOff[0].new_values==="string"?
      JSON.parse(signedOff[0].new_values):signedOff[0].new_values;
    assert.equal(recorded.approved,false);
    const stale=summarizeCatalogGovernance([{
      entityType:"TEST",disposition:"DRIFTED",
      finding:resolveFindingLifecycle({
        evidenceToken:evidence.evidenceToken,
        currentObservation:latest,decision:recorded.disposition,
      }),
    }],true);
    assert.equal(stale.totals.stale,1);
    assert.ok(stale.blockers.includes("STALE_REVIEW_EVIDENCE"));
    assert.ok(stale.blockers.includes("SIGNATORY_POLICY_UNCONFIGURED"));
    assert.equal(stale.activationAllowed,false);
    const [outsider]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM lab_tests WHERE id=? AND organization_id=?",[foreignTest,org]);
    assert.equal(outsider.length,0);
    const [decisionCount]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM audit_events WHERE action='CATALOG_BUNDLE_EXPERT_DECISION_RECORDED' AND entity_id=?",[flag]);
    assert.equal(Number(decisionCount[0].total),1);
    await reviewer.commit();
    const [preserved]=await author.execute<mysql.RowDataPacket[]>(
      "SELECT name_en FROM lab_tests WHERE id=?",[testId]);
    assert.equal(preserved[0].name_en,"New active value");
  }finally{
    await author.rollback().catch(()=>{});
    await reviewer.rollback().catch(()=>{});
    await exec("DELETE FROM audit_events WHERE id IN (?,?)",[decision,flag]).catch(()=>{});
    await exec("DELETE FROM catalog_import_rows WHERE id=?",[rowId]).catch(()=>{});
    await exec("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
    await exec("DELETE FROM lab_tests WHERE id IN (?,?)",[testId,foreignTest]).catch(()=>{});
    await exec("DELETE FROM users WHERE id IN (?,?)",[authorId,reviewerId]).catch(()=>{});
    await exec("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await exec("DELETE FROM organizations WHERE id IN (?,?)",[org,foreign]).catch(()=>{});
    await Promise.all([author.end(),reviewer.end()]);
  }
});
