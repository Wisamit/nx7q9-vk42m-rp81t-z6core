import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { observeCatalogTargetIdentity } from "../src/lib/catalog-bundle-target-identity.ts";

test("F2 MariaDB: independent sessions detect same-UUID link, membership and tariff-scope changes", {
  timeout: 60000,
}, async () => {
  if (!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
  const url = new URL(process.env.DATABASE_URL);
  const config = { host:url.hostname, port:Number(url.port || 3306),
    user:decodeURIComponent(url.username), password:decodeURIComponent(url.password),
    database:url.pathname.slice(1) };
  const [writer, reviewer] = await Promise.all([
    mysql.createConnection(config), mysql.createConnection(config),
  ]);
  const org=randomUUID(), branchA=randomUUID(), branchB=randomUUID();
  const dept=randomUUID(), testA=randomUUID(), testB=randomUUID();
  const panel=randomUUID(), priceList=randomUUID(), priceItem=randomUUID();
  const prefix="F2TI"+org.slice(0,8);
  const execute=(sql:string,values:Array<string|number|null>)=>writer.execute(sql,values);
  const sourcePanel={id:panel,code:prefix+"P",items:[{
    testId:testA,displayOrder:1,required:true,test:{code:prefix+"A"},
  }]};
  const sourceItem={id:priceItem,testId:testA,priceListId:priceList,
    test:{code:prefix+"A"},priceList:{
      code:prefix+"L",currency:"AED",scopeType:"BRANCH",branchId:branchA,
      sourceId:null,referrerId:null,clientId:null,contractId:null,status:"ACTIVE",
    }};
  const read=async()=>{
    const [p]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT p.id,p.code FROM test_panels p WHERE p.id=? AND p.organization_id=?",
      [panel,org]);
    const [members]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT i.test_id AS testId, i.display_order AS displayOrder, i.required, t.code AS testCode FROM test_panel_items i JOIN lab_tests t ON t.id=i.test_id WHERE i.panel_id=? ORDER BY i.display_order,i.test_id",
      [panel]);
    const [items]=await reviewer.execute<mysql.RowDataPacket[]>(
      "SELECT i.id,i.test_id AS testId,i.price_list_id AS priceListId, t.code AS testCode, l.code AS listCode,l.scope_type AS scopeType,l.branch_id AS branchId,l.currency,l.status, l.source_id AS sourceId,l.referrer_id AS referrerId,l.client_id AS clientId,l.contract_id AS contractId FROM price_list_items i JOIN price_lists l ON l.id=i.price_list_id JOIN lab_tests t ON t.id=i.test_id WHERE i.id=? AND l.organization_id=?",
      [priceItem,org]);
    if (p.length!==1 || items.length!==1)throw Error("synthetic_mapping_fixture_missing");
    const panelLive={id:p[0].id,code:p[0].code,items:members.map(x=>({
      testId:x.testId,displayOrder:Number(x.displayOrder),required:Boolean(x.required),
      test:{code:x.testCode},
    }))};
    const i=items[0];
    const priceLive={id:i.id,testId:i.testId,priceListId:i.priceListId,
      test:{code:i.testCode},
      priceList:{code:i.listCode,scopeType:i.scopeType,branchId:i.branchId,
        currency:i.currency,status:i.status,sourceId:i.sourceId,
        referrerId:i.referrerId,clientId:i.clientId,contractId:i.contractId}};
    return {panel:observeCatalogTargetIdentity("PANEL",sourcePanel,panelLive),
      price:observeCatalogTargetIdentity("PRICE_LIST_ITEM",sourceItem,priceLive)};
  };
  try{
    await execute("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,prefix+"O","Synthetic mapping org"]);
    for (const [id,code] of [[branchA,"A"],[branchB,"B"]])
      await execute("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [id,org,prefix+code,"Synthetic mapping branch"]);
    await execute("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [dept,org,branchA,prefix+"D","Synthetic department"]);
    for(const [id,code] of [[testA,"A"],[testB,"B"]])
      await execute("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [id,org,dept,prefix+code,"Synthetic test"]);
    await execute("INSERT INTO test_panels(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [panel,org,prefix+"P","Synthetic panel"]);
    await execute("INSERT INTO test_panel_items(panel_id,test_id,display_order,required) VALUES(?,?,1,1)",
      [panel,testA]);
    await execute("INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES(?,?,?,?,'BRANCH',?,'AED','2026-01-01',NOW(3))",
      [priceList,org,prefix+"L","Synthetic list",branchA]);
    await execute("INSERT INTO price_list_items(id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES(?,?,?,45.6700,'2026-01-01',NOW(3))",
      [priceItem,priceList,testA]);
    const baseline=await read();
    assert.equal(baseline.panel.status,"LOCAL_IDENTITY_OBSERVED");
    assert.equal(baseline.price.status,"LOCAL_IDENTITY_OBSERVED");
    assert.equal(baseline.panel.sourceInstanceProven,false);
    await execute("UPDATE test_panel_items SET test_id=? WHERE panel_id=?",
      [testB,panel]);
    assert.ok((await read()).panel.reasons.includes("COMPOSITE_MEMBERSHIP_MISMATCH"));
    await execute("UPDATE test_panel_items SET test_id=? WHERE panel_id=?",
      [testA,panel]);
    await execute("UPDATE price_lists SET currency='USD' WHERE id=?",[priceList]);
    assert.ok((await read()).price.reasons.includes("BRANCH_OR_TARIFF_SCOPE_MISMATCH"));
    await execute("UPDATE price_lists SET currency='AED',branch_id=? WHERE id=?",
      [branchB,priceList]);
    assert.ok((await read()).price.reasons.includes("BRANCH_OR_TARIFF_SCOPE_MISMATCH"));
    await execute("UPDATE price_lists SET branch_id=? WHERE id=?",[branchA,priceList]);
    await execute("UPDATE price_list_items SET test_id=? WHERE id=?",[testB,priceItem]);
    assert.ok((await read()).price.reasons.includes("PARENT_IDENTITY_MISMATCH"));
    await execute("UPDATE price_list_items SET test_id=? WHERE id=?",[testA,priceItem]);
    const restored=await read();
    assert.equal(restored.panel.status,"LOCAL_IDENTITY_OBSERVED");
    assert.equal(restored.price.status,"LOCAL_IDENTITY_OBSERVED");
    assert.equal(restored.price.autoApplyAllowed,false);
    assert.equal(restored.price.mappingApproved,false);
  } finally {
    await execute("DELETE FROM price_list_items WHERE id=?",[priceItem]).catch(()=>{});
    await execute("DELETE FROM price_lists WHERE id=?",[priceList]).catch(()=>{});
    await execute("DELETE FROM test_panel_items WHERE panel_id=?",[panel]).catch(()=>{});
    await execute("DELETE FROM test_panels WHERE id=?",[panel]).catch(()=>{});
    await execute("DELETE FROM lab_tests WHERE id IN (?,?)",[testA,testB]).catch(()=>{});
    await execute("DELETE FROM departments WHERE id=?",[dept]).catch(()=>{});
    await execute("DELETE FROM branches WHERE organization_id=?",[org]).catch(()=>{});
    await execute("DELETE FROM organizations WHERE id=?",[org]).catch(()=>{});
    await Promise.all([writer.end(),reviewer.end()]);
  }
});
