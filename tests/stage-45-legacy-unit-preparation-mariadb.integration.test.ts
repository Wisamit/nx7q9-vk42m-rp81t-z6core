import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import {
  eligibleLegacyUnitSourceRow, indexLegacyPreparedUnits,
  proposedLegacyUnitCode, resolveLegacyPreparedUnit,
} from "../src/lib/catalog-legacy-unit-preparation.ts";
import { resolveClinicalImportScope, permittedClinicalImportTest } from "../src/lib/catalog-clinical-import-scope.ts";

test("Stage 45 MariaDB: two writers serialize unit provenance; excluded rows and foreign branches cannot assign",
  {timeout:45000},async()=>{
    if(!process.env.DATABASE_URL) throw Error("DATABASE_URL required");
    const url=new URL(process.env.DATABASE_URL);
    const config={host:url.hostname,port:Number(url.port||3306),
      user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
      database:url.pathname.slice(1)};
    const [writer,reader]=await Promise.all([mysql.createConnection(config),mysql.createConnection(config)]);
    const org=randomUUID(),foreign=randomUUID(),branch=randomUUID(),otherBranch=randomUUID(),foreignBranch=randomUUID();
    const dept=randomUUID(),otherDept=randomUUID(),foreignDept=randomUUID();
    const actor=randomUUID(),testId=randomUUID(),offScopeTest=randomUUID(),foreignTest=randomUUID();
    const aUnit=randomUUID(),bUnit=randomUUID(),inactiveUnit=randomUUID(),foreignUnit=randomUUID(),newUnit=randomUUID();
    const batch=randomUUID(),importedRow=randomUUID(),skippedRow=randomUUID(),rangeRow=randomUUID(),errorRow=randomUUID();
    const tag=org.slice(0,8), prefix="S45"+tag;
    const exec=(sql:string,args:Array<string|number|null>)=>writer.execute(sql,args);
    try {
      for(const [id,suffix] of [[org,"ORG"],[foreign,"FOREIGN"]]){
        await exec("INSERT INTO organizations(id,code,name_en,updated_at) VALUES (?,?,?,NOW(3))",
          [id,prefix+suffix,"Unit Preparation Safety"]);
      }
      for(const [id,tenant,suffix] of [[branch,org,"A"],[otherBranch,org,"B"],[foreignBranch,foreign,"F"]]){
        await exec("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
          [id,tenant,prefix+suffix,"Scoped Branch"]);
      }
      for(const [id,tenant,branchId,suffix] of [[dept,org,branch,"D"],[otherDept,org,otherBranch,"E"],[foreignDept,foreign,foreignBranch,"F"]]){
        await exec("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES (?,?,?,?,?,NOW(3))",
          [id,tenant,branchId,prefix+suffix,"Scoped Department"]);
      }
      await exec("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES (?,?,?,?,NOW(3))",
        [actor,org,"s45-"+tag,"Clinical Import Author"]);
      for(const [id,tenant,code,symbol,status] of [
        [aUnit,org,"A","mg/dL","ACTIVE"],
        [bUnit,org,"B","mg/dL","ACTIVE"],
        [inactiveUnit,org,"OLD","ng/mL","INACTIVE"],
        [foreignUnit,foreign,"FOREIGN","foreign-unit","ACTIVE"],
      ]){
        await exec("INSERT INTO units(id,organization_id,code,symbol,status,updated_at) VALUES (?,?,?,?,?,NOW(3))",
          [id,tenant,prefix+code,symbol,status]);
      }
      for(const [id,tenant,department,suffix] of [
        [testId,org,dept,"IMPORTED"],[offScopeTest,org,otherDept,"OTHER"],[foreignTest,foreign,foreignDept,"FOREIGN"],
      ]){
        await exec("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES (?,?,?,?,?,NOW(3))",
          [id,tenant,department,prefix+suffix,"Old Clinical Test"]);
      }
      await exec("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,status,created_by_user_id,updated_at) VALUES (?,?,'LEGACY_MDB_EXPORT','stage45-units.json','IMPORTED',?,NOW(3))",
        [batch,org,actor]);
      const staged=[
        {id:importedRow,type:"TEST",status:"IMPORTED",target:testId,unit:"stage45-unit"},
        {id:skippedRow,type:"TEST",status:"SKIPPED",target:offScopeTest,unit:"not-authorized"},
        {id:rangeRow,type:"REFERENCE_INTERVAL",status:"WARNING",target:null,unit:"mg/dL"},
        {id:errorRow,type:"REFERENCE_INTERVAL",status:"ERROR",target:null,unit:"rejected-source"},
      ];
      for(const [i,s] of staged.entries()){
        const payload=JSON.stringify({nameEn:"Old Clinical Test",unit:s.unit});
        await exec("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,imported_entity_id,source_data,normalized_data,updated_at) VALUES (?,?,?,?,?,?,?,?,NOW(3))",
          [s.id,batch,i+1,s.type,s.status,s.target,payload,payload]);
      }
      const [stored]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,entity_type,status,imported_entity_id,normalized_data FROM catalog_import_rows WHERE batch_id=? ORDER BY `row_number`",
        [batch]);
      const parsed=stored.map(x=>({
        id:String(x.id),entityType:String(x.entity_type),status:String(x.status),
        importedEntityId:x.imported_entity_id?String(x.imported_entity_id):null,
        source:typeof x.normalized_data==="string"?JSON.parse(x.normalized_data):x.normalized_data,
      }));
      const eligible=parsed.filter(eligibleLegacyUnitSourceRow);
      assert.deepEqual(new Set(eligible.map(x=>x.id)),new Set([importedRow,rangeRow]));
      const scope=resolveClinicalImportScope({
        organizationId:org, activeBranchId:branch,
        activeBranch:{id:branch,organizationId:org,status:"ACTIVE"},
        branchScopes:[{branchId:branch,branch:{status:"ACTIVE"}}],
        departmentScopes:[{departmentId:dept,department:{status:"ACTIVE",organizationId:org,branchId:branch}}],
      });
      assert.ok(scope);
      assert.equal(permittedClinicalImportTest({departmentId:dept,department:{status:"ACTIVE",branchId:branch}},scope),true);
      assert.equal(permittedClinicalImportTest({departmentId:otherDept,department:{status:"ACTIVE",branchId:otherBranch}},scope),false);
      assert.equal(permittedClinicalImportTest({departmentId:foreignDept,department:{status:"ACTIVE",branchId:foreignBranch}},scope),false);
      const [dbUnits]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,code,symbol,status FROM units WHERE organization_id=?",[org]);
      const units=indexLegacyPreparedUnits(dbUnits.map(x=>({
        id:String(x.id),code:String(x.code),symbol:String(x.symbol),status:String(x.status),
      })));
      assert.equal(dbUnits.length,3);
      assert.deepEqual(resolveLegacyPreparedUnit(units,"mg/dL"),{kind:"ambiguous_or_inactive"});
      assert.deepEqual(resolveLegacyPreparedUnit(units,"ng/mL"),{kind:"ambiguous_or_inactive"});
      assert.deepEqual(resolveLegacyPreparedUnit(units,"foreign-unit"),{kind:"unknown"});
      assert.deepEqual(resolveLegacyPreparedUnit(units,"stage45-unit"),{kind:"unknown"});

      await writer.beginTransaction();
      const [lock]=await writer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]);
      assert.equal(lock.length,1);
      const [batchLock]=await writer.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM catalog_import_batches WHERE id=? AND organization_id=? FOR UPDATE",[batch,org]);
      assert.equal(batchLock.length,1);
      await reader.beginTransaction();
      // This independent connection must wait for the same organization lock,
      // then see the committed new unit instead of independently creating it.
      const competing=reader.execute<mysql.RowDataPacket[]>(
        "SELECT id FROM organizations WHERE id=? FOR UPDATE",[org]);
      const code=proposedLegacyUnitCode("stage45-unit");
      assert.ok(code);
      await writer.execute(
        "INSERT INTO units(id,organization_id,code,symbol,status,updated_at) VALUES(?,?,?,?,'ACTIVE',NOW(3))",
        [newUnit,org,code,"stage45-unit"]);
      const [claim]=await writer.execute<mysql.ResultSetHeader>(
        "UPDATE lab_tests SET default_unit_id=? WHERE id=? AND organization_id=? AND department_id=? AND default_unit_id IS NULL",
        [newUnit,testId,org,dept]);
      assert.equal(claim.affectedRows,1);
      await writer.commit();
      const [acquired]=await competing;
      assert.equal(acquired.length,1);
      const [unitRead]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,code,symbol,status FROM units WHERE organization_id=?",[org]);
      const after=indexLegacyPreparedUnits(unitRead.map(x=>({
        id:String(x.id),code:String(x.code),symbol:String(x.symbol),status:String(x.status),
      })));
      assert.deepEqual(resolveLegacyPreparedUnit(after,"stage45-unit"),{kind:"resolved",unitId:newUnit});
      assert.equal(unitRead.filter(x=>String(x.symbol)==="stage45-unit").length,1);
      const [replay]=await reader.execute<mysql.ResultSetHeader>(
        "UPDATE lab_tests SET default_unit_id=? WHERE id=? AND organization_id=? AND department_id=? AND default_unit_id IS NULL",
        [newUnit,testId,org,dept]);
      assert.equal(replay.affectedRows,0,"second writer must not overwrite the imported test unit");
      await reader.commit();

      const [tests]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT id,default_unit_id FROM lab_tests WHERE id IN (?,?,?)",[testId,offScopeTest,foreignTest]);
      const byId=new Map(tests.map(x=>[String(x.id),x.default_unit_id===null?null:String(x.default_unit_id)]));
      assert.equal(byId.get(testId),newUnit);
      assert.equal(byId.get(offScopeTest),null);
      assert.equal(byId.get(foreignTest),null);
      const [unchanged]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT status,imported_entity_id FROM catalog_import_rows WHERE batch_id=? ORDER BY `row_number`",[batch]);
      assert.deepEqual(unchanged.map(x=>x.status),staged.map(x=>x.status));
      assert.equal(String(unchanged[1].imported_entity_id),offScopeTest);
    } finally {
      await writer.rollback().catch(()=>{});
      await reader.rollback().catch(()=>{});
      await exec("DELETE FROM catalog_import_rows WHERE batch_id=?",[batch]).catch(()=>{});
      await exec("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
      await exec("DELETE FROM lab_tests WHERE id IN (?,?,?)",[testId,offScopeTest,foreignTest]).catch(()=>{});
      await exec("DELETE FROM units WHERE id IN (?,?,?,?,?)",[aUnit,bUnit,inactiveUnit,foreignUnit,newUnit]).catch(()=>{});
      await exec("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
      await exec("DELETE FROM departments WHERE id IN (?,?,?)",[dept,otherDept,foreignDept]).catch(()=>{});
      await exec("DELETE FROM branches WHERE id IN (?,?,?)",[branch,otherBranch,foreignBranch]).catch(()=>{});
      await exec("DELETE FROM organizations WHERE id IN (?,?)",[org,foreign]).catch(()=>{});
      await Promise.all([writer.end(),reader.end()]);
    }
  });
