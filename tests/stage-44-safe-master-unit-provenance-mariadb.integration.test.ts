import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  registerSafeMasterUnitAlias, resolveSafeMasterUnitAlias, sameSafeMasterTestDefinition,
} from "../src/lib/catalog-safe-master-units.ts";
import { registerPanelAlias, resolvedPanelMemberships } from "../src/lib/catalog-panel-membership.ts";

test("Stage 44 MariaDB: source units remain tenant-scoped, conflicts fail closed and batch claims are atomic",
  {timeout:45000}, async()=>{
    if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
    const url=new URL(process.env.DATABASE_URL);
    const cfg={host:url.hostname,port:Number(url.port||3306),
      user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
      database:url.pathname.slice(1)};
    const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
    const org=randomUUID(),otherOrg=randomUUID(),actor=randomUUID();
    const unitA=randomUUID(),unitB=randomUUID(),unitKnown=randomUUID(),foreignUnit=randomUUID();
    const existingTest=randomUUID(),otherTest=randomUUID(),createdTest=randomUUID();
    const panelId=randomUUID(),batchId=randomUUID(),row1=randomUUID(),row2=randomUUID();
    const suffix=org.slice(0,8);
    const exec=(sql:string,args:(string|number|null)[])=>writer.execute(sql,args);
    try{
      for(const [id,tag] of [[org,"LOCAL"],[otherOrg,"FOREIGN"]]){
        await exec("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
          [id,"U44"+suffix+tag,"Unit Import Safety"]);
      }
      await exec("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [actor,org,"unit44-"+suffix,"Import Reviewer"]);
      for(const [id,tenant,code,symbol] of [
        [unitA,org,"UA","mg/dL"],[unitB,org,"UB","mg/dL"],
        [unitKnown,org,"SAFE_UNIT","mmol/L"],[foreignUnit,otherOrg,"FOREIGN","ng/mL"],
      ]){
        await exec("INSERT INTO units(id,organization_id,code,symbol,updated_at) VALUES (?,?,?,?,NOW(3))",
          [id,tenant,"U44"+suffix+code,symbol]);
      }
      await exec("INSERT INTO lab_tests(id,organization_id,code,name_en,default_unit_id,assay,updated_at) VALUES (?,?,?,?,?, ?,NOW(3))",
        [existingTest,org,"U44"+suffix+"EXIST","Same Name",unitA,"Assay A"]);
      await exec("INSERT INTO lab_tests(id,organization_id,code,name_en,default_unit_id,updated_at) VALUES (?,?,?,?,?,NOW(3))",
        [otherTest,otherOrg,"U44"+suffix+"OTHER","Same Name",foreignUnit]);
      await exec("INSERT INTO test_panels(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [panelId,org,"U44"+suffix+"P","Valid Panel"]);
      await exec("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES(?,?,'LEGACY_MDB_EXPORT','units-stage44.json','VALIDATED',?,NOW(3))",
        [batchId,org,actor]);
      const sources=[
        {id:row1,code:"UNMATCHED",unit:"mg/dL"},
        {id:row2,code:"U44"+suffix+"NEW",unit:"SAFE_UNIT"},
      ];
      for(const [index,source] of sources.entries()){
        const normalized=JSON.stringify({nameEn:"Same Name",code:source.code,unit:source.unit,panel:"Valid Panel"});
        await exec("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,?,'TEST','VALID',?,?,NOW(3))",
          [source.id,batchId,index+1,normalized,normalized]);
      }

      const [dbUnits]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,code,symbol FROM units WHERE organization_id=? ORDER BY code",[org]);
      assert.equal(dbUnits.length,3,"foreign-tenant units must not enter the alias index");
      const aliases=new Map<string,string|null>();
      for(const u of dbUnits){
        registerSafeMasterUnitAlias(aliases,String(u.code),String(u.id));
        registerSafeMasterUnitAlias(aliases,String(u.symbol),String(u.id));
      }
      assert.deepEqual(resolveSafeMasterUnitAlias(aliases,"mg/dL"),
        {ok:false,reason:"UNKNOWN_OR_AMBIGUOUS_TEST_UNIT"});
      assert.deepEqual(resolveSafeMasterUnitAlias(aliases,"ng/mL"),
        {ok:false,reason:"UNKNOWN_OR_AMBIGUOUS_TEST_UNIT"});
      const known=resolveSafeMasterUnitAlias(aliases,"SAFE_UNIT");
      // The persisted code is namespaced in this fixture, unlike the display symbol.
      assert.equal(known.ok,false);
      const confirmed=resolveSafeMasterUnitAlias(aliases,"U44"+suffix+"SAFE_UNIT");
      assert.deepEqual(confirmed,{ok:true,unitId:unitKnown});

      const [persisted]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT name_en,status,default_unit_id,assay,collection_instructions,method_id,specimen_type_id,container_id,result_type,workflow_type FROM lab_tests WHERE id=? AND organization_id=?",
        [existingTest,org]);
      assert.equal(persisted.length,1);
      const e=persisted[0];
      const definition={nameEn:String(e.name_en),status:String(e.status),
        defaultUnitId:e.default_unit_id === null?null:String(e.default_unit_id),
        assay:e.assay===null?null:String(e.assay),
        collectionInstructions:e.collection_instructions===null?null:String(e.collection_instructions),
        methodId:e.method_id===null?null:String(e.method_id),
        specimenTypeId:e.specimen_type_id===null?null:String(e.specimen_type_id),
        containerId:e.container_id===null?null:String(e.container_id),
        resultType:String(e.result_type),workflowType:String(e.workflow_type)};
      assert.equal(sameSafeMasterTestDefinition(definition,
        {nameEn:"Same Name",unitId:unitB,assay:"Assay A",collection:""}),false);
      assert.equal(sameSafeMasterTestDefinition(definition,
        {nameEn:"Same Name",unitId:unitA,assay:"Assay B",collection:""}),false);
      assert.equal(sameSafeMasterTestDefinition(definition,
        {nameEn:"Same Name",unitId:unitA,assay:"Assay A",collection:""}),true);

      await writer.beginTransaction();
      const [claimed]=await writer.execute<mysql.ResultSetHeader>(
        "UPDATE catalog_import_batches SET status='IMPORTED' WHERE id=? AND organization_id=? AND status='VALIDATED'",
        [batchId,org]);
      assert.equal(claimed.affectedRows,1);
      const competing=reader.execute<mysql.ResultSetHeader>(
        "UPDATE catalog_import_batches SET status='IMPORTED' WHERE id=? AND organization_id=? AND status='VALIDATED'",
        [batchId,org]);
      await writer.execute("INSERT INTO lab_tests(id,organization_id,code,name_en,default_unit_id,updated_at) VALUES(?,?,?,?,?,NOW(3))",
        [createdTest,org,"U44"+suffix+"NEW","Same Name",unitKnown]);
      const candidates=sources.map((source,index)=>({
        id:source.id, entityType:"TEST",status:"VALID",validationIssues:[],
        normalizedData:{nameEn:"Same Name",code:source.code,panel:"Valid Panel",unit:source.unit},
        rowNumber:index+1,
      }));
      const panelAliases=new Map<string,string|null>();
      registerPanelAlias(panelAliases,"Valid Panel",panelId);
      // Ambiguous unit source row is deliberately absent from the resolution map.
      const links=resolvedPanelMemberships(candidates,new Map([[row2,createdTest]]),panelAliases);
      assert.deepEqual(links.map(x=>x.testId),[createdTest]);
      for(const link of links){
        await writer.execute("INSERT INTO test_panel_items(panel_id,test_id,display_order,required) VALUES(?,?,?,?)",
          [link.panelId,link.testId,link.displayOrder,link.required?1:0]);
      }
      const [invisible]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT test_id FROM test_panel_items WHERE panel_id=?",[panelId]);
      assert.equal(invisible.length,0,"separate connection cannot see uncommitted clinical membership");
      await writer.commit();
      const [lost]=await competing;
      assert.equal(lost.affectedRows,0,"concurrent batch claim cannot silently reimport");

      const [linked]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT t.test_id,l.default_unit_id FROM test_panel_items t JOIN lab_tests l ON l.id=t.test_id WHERE t.panel_id=?",
        [panelId]);
      assert.equal(linked.length,1);
      assert.equal(String(linked[0].test_id),createdTest);
      assert.equal(String(linked[0].default_unit_id),unitKnown);
      const [unchanged]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,default_unit_id FROM lab_tests WHERE id IN (?,?)",[existingTest,otherTest]);
      assert.deepEqual(new Map(unchanged.map(x=>[String(x.id),String(x.default_unit_id)])),
        new Map([[existingTest,unitA],[otherTest,foreignUnit]]));
      const [stageRows]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT status,imported_entity_id FROM catalog_import_rows WHERE batch_id=?",[batchId]);
      assert.ok(stageRows.every(x=>x.status==="VALID" && x.imported_entity_id===null),
        "fixture must not counterfeit source-row imports");
    }finally{
      await writer.rollback().catch(()=>{});
      await exec("DELETE FROM test_panel_items WHERE panel_id=?",[panelId]).catch(()=>{});
      await exec("DELETE FROM catalog_import_rows WHERE batch_id=?",[batchId]).catch(()=>{});
      await exec("DELETE FROM catalog_import_batches WHERE id=?",[batchId]).catch(()=>{});
      await exec("DELETE FROM test_panels WHERE id=?",[panelId]).catch(()=>{});
      await exec("DELETE FROM lab_tests WHERE id IN (?,?,?)",[existingTest,otherTest,createdTest]).catch(()=>{});
      await exec("DELETE FROM units WHERE id IN (?,?,?,?)",[unitA,unitB,unitKnown,foreignUnit]).catch(()=>{});
      await exec("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
      await exec("DELETE FROM organizations WHERE id IN (?,?)",[org,otherOrg]).catch(()=>{});
      await Promise.all([writer.end(),reader.end()]);
    }
  });
