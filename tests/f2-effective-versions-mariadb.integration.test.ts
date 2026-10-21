import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { f2MysqlTransactionalTestClient } from "./f2-effective-versions-mariadb-driver.ts";
import { applyF2EffectiveVersionsUnderLock } from "../src/lib/catalog-f2-effective-versions.ts";
import { reverseF2FutureEffectiveVersionsUnderLock } from "../src/lib/catalog-f2-effective-reversal.ts";
import type { F2ApplyPlanRow } from "../src/lib/catalog-f2-apply-plan.ts";
import { canonicalF2TestPlan } from "./f2-canonical-application-fixture.ts";

test("F2 MariaDB: atomic synthetic price/package/range versions and compensating reversal preserve original master IDs",{
  timeout:90000,
},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const sql=await mysql.createConnection({
    host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
    database:url.pathname.slice(1),
  });
  const organizationId=randomUUID(),branchId=randomUUID(),actorUserId=randomUUID(),
    clinician=randomUUID(),finance=randomUUID(),batchId=randomUUID();
  const testId=randomUUID(),componentId=randomUUID(),packageId=randomUUID(),
    priceListId=randomUUID(),oldTestPriceId=randomUUID(),
    oldPackagePriceId=randomUUID(),oldIntervalId=randomUUID();
  const oldStart="2026-01-01T00:00:00.000Z",
    nextStart="2026-12-01T00:00:00.000Z",
    prefix="F2E"+organizationId.slice(0,8);
  const query=(statement:string,values:Array<string|number|null>)=>sql.execute(statement,values);
  const transaction=async<T>(
    work:(tx:ReturnType<typeof f2MysqlTransactionalTestClient>)=>Promise<T>,
  ):Promise<T>=>{
    await sql.beginTransaction();
    try {
      const [lock]=await sql.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE id=? AND status='ACTIVE' FOR UPDATE",
        [organizationId]);
      assert.equal(lock.length,1,"test transaction owns the same tenant lock");
      const outcome=await work(f2MysqlTransactionalTestClient(sql));
      await sql.commit();
      return outcome;
    }catch(error){await sql.rollback();throw error;}
  };
  const authority={
    organizationId,branchId,batchId,actorUserId,
    clinicalSignerId:clinician,financialSignerId:finance,
    journalSigningSecret:"f2-mariadb-real-transaction-test-key-not-production-32",
    sourceInstallationVerified:true,qualifiedDomainSignersVerified:true,
    currentPermissionsAndBranchScopeVerified:true,signedStageAndLiveSnapshotVerified:true,
  } as const;
  const priceRow=(entityType:"PRICE_LIST_ITEM"|"PRICE_LIST_PACKAGE_ITEM",
    n:number,ident:string,relation:string):F2ApplyPlanRow=>{
    const common={id:ident,priceListId,
      effectiveFrom:oldStart,effectiveTo:null,status:"ACTIVE"};
    const old={...common,
      [entityType==="PRICE_LIST_ITEM"?"testId":"packageId"]:relation,
      unitPrice:"150.0000"};
    const desired={...old,unitPrice:"122.7500"};
    return {
      rowNumber:n,entityType,targetId:ident,
      operation:"EFFECTIVE_DATED_NEW_VERSION",changedFields:["unitPrice"],
      originalSnapshot:old,desiredSnapshot:desired,
      originalDigest:"a".repeat(64),desiredDigest:"b".repeat(64),
    };
  };
  const oldInterval={
    id:oldIntervalId,componentId,branchId:null,methodId:null,
    analyzerId:null,specimenTypeId:null,sex:"ANY",
    ageFrom:null,ageTo:null,ageUnit:null,pregnancyStatus:null,
    gestationalAgeFromWeeks:null,gestationalAgeToWeeks:null,
    populationCode:null,lowValue:"1.000000",highValue:"9.000000",
    normalTextEn:null,normalTextAr:null,criticalLow:"0.500000",
    criticalHigh:"10.000000",source:null,notes:null,
    effectiveFrom:oldStart,effectiveTo:null,status:"ACTIVE",
    approvalStatus:"APPROVED",
  };
  const rows:F2ApplyPlanRow[]=[
    priceRow("PRICE_LIST_ITEM",1,oldTestPriceId,testId),
    priceRow("PRICE_LIST_PACKAGE_ITEM",2,oldPackagePriceId,packageId),
    {rowNumber:3,entityType:"REFERENCE_INTERVAL",targetId:oldIntervalId,
      operation:"EFFECTIVE_DATED_NEW_VERSION",changedFields:["criticalLow"],
      originalSnapshot:oldInterval,
      desiredSnapshot:{...oldInterval,criticalLow:"0.750000"},
      originalDigest:"c".repeat(64),desiredDigest:"d".repeat(64)},
  ];
  const plan=canonicalF2TestPlan({rows,effectiveAt:nextStart});
  try{
    await query("INSERT INTO organizations (id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [organizationId,prefix+"O","Synthetic F2 Version Lab"]);
    await query("INSERT INTO branches (id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branchId,organizationId,prefix+"B","Synthetic F2 branch"]);
    for(const [id,tag] of [[actorUserId,"A"],[clinician,"C"],[finance,"F"]])
      await query("INSERT INTO users (id,organization_id,username,display_name_en,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
        [id,organizationId,prefix+tag,"Synthetic F2 signer"]);
    await query("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,source_checksum,status,created_by_user_id,updated_at) VALUES(?,?,'CONFIG_BUNDLE_REVIEW','synthetic.json',?,'DRAFT',?,NOW(3))",
      [batchId,organizationId,"e".repeat(64),actorUserId]);
    await query("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,organizationId,prefix+"T","Synthetic F2 Test"]);
    await query("INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [componentId,testId,prefix+"C","Synthetic F2 Result"]);
    await query("INSERT INTO commercial_packages(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [packageId,organizationId,prefix+"P","Synthetic F2 Package"]);
    await query("INSERT INTO price_lists(id,organization_id,code,name_en,currency,effective_from,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [priceListId,organizationId,prefix+"L","Synthetic F2 Tariffs","AED","2026-01-01 00:00:00.000"]);
    await query("INSERT INTO price_list_items(id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [oldTestPriceId,priceListId,testId,"150.0000","2026-01-01 00:00:00.000"]);
    await query("INSERT INTO price_list_package_items(id,price_list_id,package_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [oldPackagePriceId,priceListId,packageId,"150.0000","2026-01-01 00:00:00.000"]);
    await query("INSERT INTO reference_intervals(id,component_id,sex,low_value,high_value,critical_low,critical_high,effective_from,approval_status,status,updated_at) VALUES(? ,?,'ANY',?,?,?,?,?,'APPROVED','ACTIVE',NOW(3))",
      [oldIntervalId,componentId,"1.000000","9.000000","0.500000","10.000000","2026-01-01 00:00:00.000"]);
    // An independently changed money field must make the signed plan stale.
    await query("UPDATE price_list_items SET unit_price=? WHERE id=?",
      ["151.0000",oldTestPriceId]);
    await assert.rejects(()=>transaction(tx=>applyF2EffectiveVersionsUnderLock(
      tx as never,plan,authority,new Date("2026-10-21T00:00:00.000Z"))),
      /f2_apply_price_conflict/);
    const [stalePrice]=await sql.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM price_list_items WHERE price_list_id=?",
      [priceListId]);
    assert.equal(Number(stalePrice[0].count),1,
      "stale signed price cannot create an extra version");
    await query("UPDATE price_list_items SET unit_price=? WHERE id=?",
      ["150.0000",oldTestPriceId]);
    // Equally, a changed critical threshold may not be overwritten merely
    // because the old version retained its UUID/effective dates.
    await query("UPDATE reference_intervals SET critical_low=? WHERE id=?",
      ["0.600000",oldIntervalId]);
    await assert.rejects(()=>transaction(tx=>applyF2EffectiveVersionsUnderLock(
      tx as never,plan,authority,new Date("2026-10-21T00:00:00.000Z"))),
      /f2_apply_range_conflict/);
    const [noPartial]=await sql.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS count FROM price_list_items WHERE price_list_id=?",
      [priceListId]);
    assert.equal(Number(noPartial[0].count),1,
      "clinical drift must roll back all earlier financial version writes");
    await query("UPDATE reference_intervals SET critical_low=? WHERE id=?",
      ["0.500000",oldIntervalId]);
    const apply=await transaction(tx=>applyF2EffectiveVersionsUnderLock(
      tx as never,plan,authority,new Date("2026-10-21T00:00:00.000Z")));
    assert.equal(apply.changedRows,3);
    assert.equal(apply.createdVersionIds.length,3);
    const [prices]=await sql.execute<mysql.RowDataPacket[]>(
      "SELECT id,unit_price,effective_from,effective_to,status FROM price_list_items WHERE price_list_id=? ORDER BY effective_from",
      [priceListId]);
    assert.equal(prices.length,2);
    assert.equal(String(prices[0].id),oldTestPriceId);
    assert.equal(String(prices[0].unit_price),"150.0000");
    assert.equal(String(prices[1].unit_price),"122.7500");
    assert.equal(prices[0].effective_to!==null,true);
    // MariaDB's existing tariff resolver treats effective_to as INCLUSIVE.
    // The old and new price must never both be billable at midnight, and
    // the prior price remains billable at the final preceding millisecond.
    const atStart="2026-12-01 00:00:00.000";
    const beforeStart="2026-11-30 23:59:59.999";
    for(const [at,expectedId] of [
      [atStart,prices[1].id],[beforeStart,oldTestPriceId],
    ]){
      const [matching]=await sql.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM price_list_items WHERE price_list_id=? AND test_id=? AND status='ACTIVE' AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",
        [priceListId,testId,at,at]);
      assert.deepEqual(matching.map(row=>row.id),[expectedId],
        "exact tariff cutoff must resolve ONE signed price revision");
    }
    const [packageMatching]=await sql.execute<mysql.RowDataPacket[]>(
      "SELECT id FROM price_list_package_items WHERE price_list_id=? AND package_id=? AND status='ACTIVE' AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",
      [priceListId,packageId,atStart,atStart]);
    assert.equal(packageMatching.length,1,
      "package prices must not overlap exactly at new effective timestamp");
    assert.notEqual(packageMatching[0].id,oldPackagePriceId);
    const [ranges]=await sql.execute<mysql.RowDataPacket[]>(
      "SELECT id,critical_low,approval_status,effective_to FROM reference_intervals WHERE component_id=?",
      [componentId]);
    assert.equal(ranges.length,2);
    assert.equal(ranges.some(r=>r.id===oldIntervalId&&r.effective_to!==null),true);
    const newRange=ranges.find(r=>r.id!==oldIntervalId);
    assert.ok(newRange);
    // Critical thresholds must resolve to exactly ONE approved reference
    // interval at the cutoff (consistent with existing inclusive ranges).
    for(const [at,expectedId] of [
      [atStart,newRange.id],[beforeStart,oldIntervalId],
    ]){
      const [effective]=await sql.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM reference_intervals WHERE component_id=? AND status='ACTIVE' AND approval_status='APPROVED' AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",
        [componentId,at,at]);
      assert.deepEqual(effective.map(row=>row.id),[expectedId],
        "an exact report timestamp cannot select two incompatible critical ranges");
    }
    const replay=await transaction(tx=>applyF2EffectiveVersionsUnderLock(
      tx as never,plan,authority,new Date("2026-10-21T00:00:00.000Z")));
    assert.equal(replay.state,"EFFECTIVE_VERSIONS_ALREADY_APPLIED");
    // A future-version compensation must not silently resurrect an original
    // price or critical threshold that was edited after the signed apply.
    await query("UPDATE price_list_items SET unit_price=? WHERE id=?",
      ["171.0000",oldTestPriceId]);
    await assert.rejects(()=>transaction(tx=>reverseF2FutureEffectiveVersionsUnderLock(
      tx as never,plan,authority,new Date("2026-11-01T00:00:00.000Z"))),
      /f2_reversal_old_price_changed/);
    await query("UPDATE price_list_items SET unit_price=? WHERE id=?",
      ["150.0000",oldTestPriceId]);
    await query("UPDATE reference_intervals SET critical_low=? WHERE id=?",
      ["0.650000",oldIntervalId]);
    await assert.rejects(()=>transaction(tx=>reverseF2FutureEffectiveVersionsUnderLock(
      tx as never,plan,authority,new Date("2026-11-01T00:00:00.000Z"))),
      /f2_reversal_old_range_changed/);
    await query("UPDATE reference_intervals SET critical_low=? WHERE id=?",
      ["0.500000",oldIntervalId]);
    const reverted=await transaction(tx=>reverseF2FutureEffectiveVersionsUnderLock(
      tx as never,plan,authority,new Date("2026-11-01T00:00:00.000Z")));
    assert.equal(reverted.state,"FUTURE_EFFECTIVE_VERSIONS_REVERSED");
    const again=await transaction(tx=>reverseF2FutureEffectiveVersionsUnderLock(
      tx as never,plan,authority,new Date("2026-11-01T00:00:00.000Z")));
    assert.equal(again.state,"FUTURE_VERSIONS_ALREADY_REVERSED");
    await assert.rejects(()=>transaction(tx=>applyF2EffectiveVersionsUnderLock(
      tx as never,plan,authority,new Date("2026-11-01T00:00:00.000Z"))),
      /f2_apply_batch_previously_reversed/,
      "previously compensated signed batch must not re-activate archived versions");
    const [post]=await sql.execute<mysql.RowDataPacket[]>(
      "SELECT id,effective_to,status FROM price_list_items WHERE price_list_id=? ORDER BY effective_from",
      [priceListId]);
    assert.equal(post.length,2);
    assert.equal(post.find(row=>row.id===oldTestPriceId)?.effective_to,null);
    assert.equal(post.find(row=>row.id!==oldTestPriceId)?.status,"INACTIVE");
    const [postRange]=await sql.execute<mysql.RowDataPacket[]>(
      "SELECT id,effective_to,status FROM reference_intervals WHERE component_id=?",
      [componentId]);
    assert.equal(postRange.find(row=>row.id===oldIntervalId)?.effective_to,null);
    assert.equal(postRange.find(row=>row.id!==oldIntervalId)?.status,"INACTIVE");
  }finally{
    await query("DELETE FROM audit_events WHERE organization_id=?",[organizationId]).catch(()=>{});
    await query("DELETE FROM reference_intervals WHERE component_id=?",[componentId]).catch(()=>{});
    await query("DELETE FROM price_list_package_items WHERE price_list_id=?",[priceListId]).catch(()=>{});
    await query("DELETE FROM price_list_items WHERE price_list_id=?",[priceListId]).catch(()=>{});
    await query("DELETE FROM catalog_import_batches WHERE id=?",[batchId]).catch(()=>{});
    await query("DELETE FROM test_components WHERE id=?",[componentId]).catch(()=>{});
    await query("DELETE FROM commercial_packages WHERE id=?",[packageId]).catch(()=>{});
    await query("DELETE FROM price_lists WHERE id=?",[priceListId]).catch(()=>{});
    await query("DELETE FROM lab_tests WHERE id=?",[testId]).catch(()=>{});
    await query("DELETE FROM users WHERE id IN (?,?,?)",[actorUserId,clinician,finance]).catch(()=>{});
    await query("DELETE FROM branches WHERE id=?",[branchId]).catch(()=>{});
    await query("DELETE FROM organizations WHERE id=?",[organizationId]).catch(()=>{});
    await sql.end();
  }
});
