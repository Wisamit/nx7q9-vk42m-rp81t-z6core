import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { prisma } from "../src/lib/db.ts";
import { applyF2EffectiveVersionsUnderLock } from "../src/lib/catalog-f2-effective-versions.ts";
import { reverseF2FutureEffectiveVersionsUnderLock } from "../src/lib/catalog-f2-effective-reversal.ts";
import type { F2ApplyPlan,F2ApplyPlanRow } from "../src/lib/catalog-f2-apply-plan.ts";

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
  const plan:F2ApplyPlan={
    format:"F2_TEN_CLASS_EXECUTABLE_PLAN_V1",
    totalRows:3,changedRows:3,unchangedRows:0,rows,
    operations:{UNCHANGED:0,SCALAR_VERSIONED_CHANGE:0,
      COMPOSITE_MEMBERSHIP_CHANGE:0,EFFECTIVE_DATED_NEW_VERSION:3},
    planDigest:"e".repeat(64),effectiveAt:nextStart,
  };
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
    const apply=await prisma.$transaction(async tx=>{
      const locks=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM organizations WHERE id=${organizationId} AND status='ACTIVE' FOR UPDATE`;
      assert.equal(locks.length,1);
      return applyF2EffectiveVersionsUnderLock(tx,plan,authority,
        new Date("2026-10-21T00:00:00.000Z"));
    },{isolationLevel:"RepeatableRead",timeout:30000});
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
    const [ranges]=await sql.execute<mysql.RowDataPacket[]>(
      "SELECT id,critical_low,approval_status,effective_to FROM reference_intervals WHERE component_id=?",
      [componentId]);
    assert.equal(ranges.length,2);
    assert.equal(ranges.some(r=>r.id===oldIntervalId&&r.effective_to!==null),true);
    const replay=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM organizations WHERE id=${organizationId} FOR UPDATE`;
      return applyF2EffectiveVersionsUnderLock(tx,plan,authority,
        new Date("2026-10-21T00:00:00.000Z"));
    });
    assert.equal(replay.state,"EFFECTIVE_VERSIONS_ALREADY_APPLIED");
    const reverted=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM organizations WHERE id=${organizationId} FOR UPDATE`;
      return reverseF2FutureEffectiveVersionsUnderLock(tx,plan,authority,
        new Date("2026-11-01T00:00:00.000Z"));
    });
    assert.equal(reverted.state,"FUTURE_EFFECTIVE_VERSIONS_REVERSED");
    const again=await prisma.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM organizations WHERE id=${organizationId} FOR UPDATE`;
      return reverseF2FutureEffectiveVersionsUnderLock(tx,plan,authority,
        new Date("2026-11-01T00:00:00.000Z"));
    });
    assert.equal(again.state,"FUTURE_VERSIONS_ALREADY_REVERSED");
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
