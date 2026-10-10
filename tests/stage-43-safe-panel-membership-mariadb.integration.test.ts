import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { registerPanelAlias, resolvedPanelMemberships } from "../src/lib/catalog-panel-membership.ts";

test("Stage 43 MariaDB: panel links use verified source row IDs, not shared test names or rejected rows",
  {timeout:45000}, async()=>{
    if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    const url=new URL(process.env.DATABASE_URL);
    const cfg={host:url.hostname,port:Number(url.port||3306),
      user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
      database:url.pathname.slice(1)};
    const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
    const org=randomUUID(),otherOrg=randomUUID(),actor=randomUUID();
    const panel=randomUUID(),testA=randomUUID(),testB=randomUUID(),testOther=randomUUID();
    const batch=randomUUID(),suffix=org.slice(0,8);
    const ids=[randomUUID(),randomUUID(),randomUUID(),randomUUID(),randomUUID()];
    const exec=(sql:string,args:(string|number|null)[])=>writer.execute(sql,args);
    try {
      for(const [id,tag] of [[org,"OWN"],[otherOrg,"OTHER"]])
        await exec("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
          [id,"P43"+suffix+tag,"Panel Safety Lab"]);
      await exec("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [actor,org,"panel43-"+suffix,"Panel Importer"]);
      for(const [id,tenant,code] of [
        [testA,org,"A"],[testB,org,"B"],[testOther,otherOrg,"X"],
      ])
        await exec("INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id,tenant,"P43"+suffix+code,"Identical Name"]);
      await exec("INSERT INTO test_panels(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [panel,org,"P43"+suffix+"P","Shared Panel"]);
      await exec("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES (?,?,'LEGACY_MDB_EXPORT','stage43.json','VALIDATED',?,NOW(3))",
        [batch,org,actor]);
      const sourceRows=[
        {id:ids[0],status:"VALID",code:"A"},
        {id:ids[1],status:"VALID",code:"B"},
        {id:ids[2],status:"ERROR",code:"BAD"},
        {id:ids[3],status:"SKIPPED",code:"OLD"},
        {id:ids[4],status:"VALID",code:"UNRESOLVED"},
      ];
      for(let i=0;i<sourceRows.length;i++){
        const r=sourceRows[i];
        const source=JSON.stringify({nameEn:"Identical Name",code:r.code,panel:"Shared Panel"});
        await exec(
          "INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,?,'TEST',?,?,?,NOW(3))",
          [r.id,batch,i+1,r.status,source,source]);
      }
      const [staged]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,entity_type,status,validation_issues,normalized_data FROM catalog_import_rows WHERE batch_id=? ORDER BY `row_number`",
        [batch]);
      const candidates=staged.map(raw=>({
        id:String(raw.id),entityType:String(raw.entity_type),status:String(raw.status),
        validationIssues:typeof raw.validation_issues==="string" ? JSON.parse(raw.validation_issues) : raw.validation_issues,
        normalizedData:typeof raw.normalized_data==="string" ? JSON.parse(raw.normalized_data) : raw.normalized_data,
      }));
      const aliases=new Map<string,string|null>();
      registerPanelAlias(aliases,"Shared Panel",panel);
      const resolved=new Map([[ids[0],testA],[ids[1],testB],
        // A stale or forged resolution must never make these states eligible.
        [ids[2],testOther],[ids[3],testOther]]);
      const links=resolvedPanelMemberships(candidates,resolved,aliases);
      assert.deepEqual(new Set(links.map(l=>l.testId)),new Set([testA,testB]));
      assert.equal(links.length,2);
      await writer.beginTransaction();
      for(const link of links)
        await writer.execute("INSERT INTO test_panel_items(panel_id,test_id,display_order,required) VALUES (?,?,?,?)",
          [link.panelId,link.testId,link.displayOrder,link.required?1:0]);
      const [beforeCommit]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT test_id FROM test_panel_items WHERE panel_id=?",[panel]);
      assert.equal(beforeCommit.length,0,"the reader must not see uncommitted panel relationships");
      await writer.commit();
      const [committed]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT test_id FROM test_panel_items WHERE panel_id=? ORDER BY test_id",[panel]);
      assert.deepEqual(new Set(committed.map(x=>String(x.test_id))),new Set([testA,testB]));
      assert.ok(!committed.some(x=>String(x.test_id)===testOther));
      const [unchanged]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT status,imported_entity_id FROM catalog_import_rows WHERE batch_id=? ORDER BY `row_number`",[batch]);
      assert.deepEqual(unchanged.map(x=>String(x.status)),sourceRows.map(x=>x.status));
      assert.ok(unchanged.every(x=>x.imported_entity_id===null));
    } finally {
      await writer.rollback().catch(()=>{});
      await exec("DELETE FROM test_panel_items WHERE panel_id=?",[panel]).catch(()=>{});
      await exec("DELETE FROM catalog_import_rows WHERE batch_id=?",[batch]).catch(()=>{});
      await exec("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
      await exec("DELETE FROM test_panels WHERE id=?",[panel]).catch(()=>{});
      await exec("DELETE FROM lab_tests WHERE id IN (?,?,?)",[testA,testB,testOther]).catch(()=>{});
      await exec("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
      await exec("DELETE FROM organizations WHERE id IN (?,?)",[org,otherOrg]).catch(()=>{});
      await Promise.all([writer.end(),reader.end()]);
    }
  });
