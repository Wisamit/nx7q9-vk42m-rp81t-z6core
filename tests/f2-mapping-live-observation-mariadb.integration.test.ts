import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { prisma } from "../src/lib/db.ts";
import { catalogExportTypes, type CatalogExportType } from "../src/lib/catalog-configuration-export.ts";
import { readCatalogLiveObservations } from "../src/lib/catalog-live-observation.ts";
import { catalogDriftObservationToken, matchesCatalogDriftObservation } from "../src/lib/catalog-drift-triage.ts";
import { createMappingDiscussionDraft } from "../src/lib/catalog-mapping-discussion-draft.ts";
import { independentMappingInspection } from "../src/lib/catalog-mapping-independent-inspection.ts";

test("F2 MariaDB: independent fresh observations cover all ten scoped live projections and reject mutation",
{timeout:90000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const u=new URL(process.env.DATABASE_URL);
  const writer=await mysql.createConnection({
    host:u.hostname,port:Number(u.port||3306),user:decodeURIComponent(u.username),
    password:decodeURIComponent(u.password),database:u.pathname.slice(1),
  });
  const org=randomUUID(),foreignOrg=randomUUID(),branch=randomUUID(),dept=randomUUID(),
    testId=randomUUID(),unit=randomUUID(),tube=randomUUID(),component=randomUUID(),
    panel=randomUUID(),pkg=randomUUID(),interval=randomUUID(),list=randomUUID(),
    item=randomUUID(),packageItem=randomUUID();
  const code="F2LO"+org.slice(0,8),checksum="a".repeat(64);
  const secret="f2-live-synthetic-independent-signing-key-32-bytes";
  const ids:ReadonlyMap<CatalogExportType,string[]> = new Map([
    ["TEST",[testId]],["COMPONENT",[component]],["UNIT",[unit]],
    ["CONTAINER",[tube]],["PANEL",[panel]],["PACKAGE",[pkg]],
    ["REFERENCE_INTERVAL",[interval]],["PRICE_LIST",[list]],
    ["PRICE_LIST_ITEM",[item]],["PRICE_LIST_PACKAGE_ITEM",[packageItem]],
  ]);
  const scope={organizationId:org,branchId:branch,departmentIds:[dept]};
  const write=(sql:string,values:Array<string|number|null>)=>writer.execute(sql,values);
  const read=async(readScope=scope,grants:readonly string[]=[branch])=>
    prisma.$transaction(async tx=>{
      const locked=await tx.$queryRaw<Array<{id:string}>>`
        SELECT id FROM organizations WHERE id=${readScope.organizationId} AND status='ACTIVE' FOR UPDATE
      `;
      if(locked.length!==1)return null;
      return readCatalogLiveObservations(tx,readScope,grants,ids);
    },{isolationLevel:"RepeatableRead",timeout:20000});
  try {
    for(const [id,suffix] of [[org,"A"],[foreignOrg,"F"]])
      await write("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
        [id,code+suffix,"F2 synthetic live proof org"]);
    await write("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [branch,org,code+"B","Synthetic branch"]);
    await write("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [dept,org,branch,code+"D","Synthetic department"]);
    await write("INSERT INTO units(id,organization_id,code,symbol,updated_at) VALUES(?,?,?,?,NOW(3))",
      [unit,org,code+"U","mg/dL"]);
    await write("INSERT INTO containers(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [tube,org,code+"C","Synthetic tube"]);
    await write("INSERT INTO lab_tests(id,organization_id,department_id,container_id,code,name_en,updated_at) VALUES(?,?,?,?,?,?,NOW(3))",
      [testId,org,dept,tube,code+"T","Synthetic test"]);
    await write("INSERT INTO test_components(id,test_id,unit_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
      [component,testId,unit,code+"A","Synthetic analyte"]);
    await write("INSERT INTO reference_intervals(id,component_id,branch_id,low_value,high_value,effective_from,approval_status,status,updated_at) VALUES(?,?,?,?,?,'2026-01-01','APPROVED','ACTIVE',NOW(3))",
      [interval,component,branch,"3.100000","7.200000"]);
    await write("INSERT INTO test_panels(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [panel,org,code+"P","Synthetic panel"]);
    await write("INSERT INTO test_panel_items(panel_id,test_id,display_order,required) VALUES(?,?,1,1)",
      [panel,testId]);
    await write("INSERT INTO commercial_packages(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [pkg,org,code+"K","Synthetic package"]);
    await write("INSERT INTO commercial_package_items(package_id,test_id,display_order) VALUES(?,?,1)",
      [pkg,testId]);
    await write("INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES(?,?,?,?,'BRANCH',?,'AED','2026-01-01',NOW(3))",
      [list,org,code+"L","Synthetic list",branch]);
    await write("INSERT INTO price_list_items(id,price_list_id,test_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?,'2026-01-01',NOW(3))",
      [item,list,testId,"45.6700"]);
    await write("INSERT INTO price_list_package_items(id,price_list_id,package_id,unit_price,effective_from,updated_at) VALUES(?,?,?,?,'2026-01-01',NOW(3))",
      [packageItem,list,pkg,"123.4500"]);

    assert.equal(catalogExportTypes.size,10);
    const before=await read();
    assert.equal(before?.size,10);
    assert.equal(await read(scope,[]),null,"revoked branch pricing cannot be inspected");
    assert.equal(await read({organizationId:foreignOrg,branchId:branch,departmentIds:[dept]}),null,
      "foreign organization cannot replay source target IDs");
    if(!before)throw Error("synthetic_baseline_missing");
    const source=new Map<string,unknown>(),tokens=new Map<string,string>();
    let number=0;
    for(const type of catalogExportTypes) {
      number++;
      const id=ids.get(type)![0],live=before.get(type+":"+id);
      assert.ok(live,type);
      const staged={id,example:"private synthetic source",kind:type};
      source.set(type,staged);
      const token=catalogDriftObservationToken(secret,checksum,number,type,staged,live);
      tokens.set(type,token);
      const original=await read();
      assert.ok(matchesCatalogDriftObservation(token,catalogDriftObservationToken(
        secret,checksum,number,type,staged,original?.get(type+":"+id))),type);
    }
    const context={
      organizationId:org,batchId:randomUUID(),branchId:branch,
      rowId:randomUUID(),authorUserId:randomUUID(),
      sourceChecksum:checksum,rowNumber:1,entityType:"TEST",
    };
    const draft=createMappingDiscussionDraft(context,{
      revision:1,previousDigest:null,observationToken:tokens.get("TEST")!,
      intent:"REQUEST_EXTERNAL_MAPPING",
    },secret);
    const permissions=new Set(["catalog.manage","catalog.reference_ranges.manage"]);
    assert.equal(independentMappingInspection({
      entityType:"TEST",authenticatedDraft:draft,currentObservationToken:tokens.get("TEST")!,
      userId:randomUUID(),authorUserId:context.authorUserId,
      originalPermissions:permissions,currentPermissions:permissions,
    })?.currentLiveObservationRevalidated,true);

    // Each mutation changes a different exact selected projection, including
    // nested member relationships, range decimals and both exact tariff scales.
    await write("UPDATE lab_tests SET name_en='Updated' WHERE id=?",[testId]);
    await write("UPDATE test_components SET report_name_en='Changed' WHERE id=?",[component]);
    await write("UPDATE units SET symbol='mmol/L' WHERE id=?",[unit]);
    await write("UPDATE containers SET tube_color='Blue' WHERE id=?",[tube]);
    await write("UPDATE test_panel_items SET required=0 WHERE panel_id=?",[panel]);
    await write("UPDATE commercial_package_items SET display_order=9 WHERE package_id=?",[pkg]);
    await write("UPDATE reference_intervals SET low_value='3.100001' WHERE id=?",[interval]);
    await write("UPDATE price_lists SET currency='USD' WHERE id=?",[list]);
    await write("UPDATE price_list_items SET unit_price='45.6701' WHERE id=?",[item]);
    await write("UPDATE price_list_package_items SET unit_price='123.4501' WHERE id=?",[packageItem]);
    const after=await read();
    assert.equal(after?.size,10);
    for(const [index,type] of [...catalogExportTypes].entries()) {
      const id=ids.get(type)![0],newToken=catalogDriftObservationToken(
        secret,checksum,index+1,type,source.get(type),after?.get(type+":"+id));
      assert.equal(matchesCatalogDriftObservation(tokens.get(type),newToken),false,
        type+" mutation must stale author evidence");
    }
    const freshTest=catalogDriftObservationToken(secret,checksum,1,
      "TEST",source.get("TEST"),after?.get("TEST:"+testId));
    assert.equal(independentMappingInspection({
      entityType:"TEST",authenticatedDraft:draft,currentObservationToken:freshTest,
      userId:randomUUID(),authorUserId:context.authorUserId,
      originalPermissions:permissions,currentPermissions:permissions,
    }),null,"stale author token cannot become qualified independent approval");
    assert.equal(await read(scope,[]),null);
    // No review endpoint/master data writes, approval or import publication.
  }finally{
    await write("DELETE FROM price_list_package_items WHERE id=?",[packageItem]).catch(()=>{});
    await write("DELETE FROM price_list_items WHERE id=?",[item]).catch(()=>{});
    await write("DELETE FROM price_lists WHERE id=?",[list]).catch(()=>{});
    await write("DELETE FROM commercial_package_items WHERE package_id=?",[pkg]).catch(()=>{});
    await write("DELETE FROM test_panel_items WHERE panel_id=?",[panel]).catch(()=>{});
    await write("DELETE FROM commercial_packages WHERE id=?",[pkg]).catch(()=>{});
    await write("DELETE FROM test_panels WHERE id=?",[panel]).catch(()=>{});
    await write("DELETE FROM reference_intervals WHERE id=?",[interval]).catch(()=>{});
    await write("DELETE FROM test_components WHERE id=?",[component]).catch(()=>{});
    await write("DELETE FROM lab_tests WHERE id=?",[testId]).catch(()=>{});
    await write("DELETE FROM containers WHERE id=?",[tube]).catch(()=>{});
    await write("DELETE FROM units WHERE id=?",[unit]).catch(()=>{});
    await write("DELETE FROM departments WHERE id=?",[dept]).catch(()=>{});
    await write("DELETE FROM branches WHERE id=?",[branch]).catch(()=>{});
    await write("DELETE FROM organizations WHERE id IN (?,?)",[org,foreignOrg]).catch(()=>{});
    await writer.end();
  }
});
