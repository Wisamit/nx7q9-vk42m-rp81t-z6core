import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import { clinicalImportTestWhere, resolveClinicalImportScope } from "../src/lib/catalog-clinical-import-scope.ts";
import { stagedPriceTestCode } from "../src/lib/catalog-import-disclosure.ts";

test("Stage 42 MariaDB two sessions: staged price test identities cannot cross branch, department or tenant",
  {timeout:45000}, async()=>{
    if(!process.env.DATABASE_URL) throw new Error("DATABASE_URL required");
    const url=new URL(process.env.DATABASE_URL);
    const cfg={host:url.hostname,port:Number(url.port||3306),
      user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
      database:url.pathname.slice(1)};
    const [writer,reader]=await Promise.all([mysql.createConnection(cfg),mysql.createConnection(cfg)]);
    const org=randomUUID(),other=randomUUID(),branchA=randomUUID(),branchB=randomUUID();
    const dA=randomUUID(),dB=randomUUID(),dOther=randomUUID();
    const tA=randomUUID(),tB=randomUUID(),tOther=randomUUID();
    const actor=randomUUID(),batch=randomUUID(),list=randomUUID(),suffix=org.slice(0,8);
    const prefix="P42"+suffix;
    const exec=(sql:string,values:(string|number|null)[])=>writer.execute(sql,values);
    try {
      for(const [id,code] of [[org,"OWN"],[other,"OTHER"]])
        await exec("INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
          [id,prefix+code,"Stage 42 Privacy"]);
      for(const [id,tenant,code] of [[branchA,org,"A"],[branchB,org,"B"]])
        await exec("INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id,tenant,prefix+code,"Price Branch"]);
      for(const [id,tenant,branch,code] of [
        [dA,org,branchA,"DA"],[dB,org,branchB,"DB"],[dOther,other,null,"DF"],
      ])
        await exec("INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
          [id,tenant,branch,prefix+code,"Price Department"]);
      for(const [id,tenant,department,code] of [
        [tA,org,dA,"TA"],[tB,org,dB,"TB"],[tOther,other,dOther,"TF"],
      ])
        await exec("INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
          [id,tenant,department,prefix+code,"Price Test"]);
      await exec("INSERT INTO users(id,organization_id,username,display_name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
        [actor,org,"p42-"+suffix,"Price Reviewer"]);
      await exec("INSERT INTO price_lists(id,organization_id,code,name_en,scope_type,branch_id,currency,effective_from,updated_at) VALUES (?,?,?,'Review List','ORGANIZATION',NULL,'AED','2026-01-01',NOW(3))",
        [list,org,prefix+"LIST"]);
      await exec("INSERT INTO catalog_import_batches(id,organization_id,source_type,source_name,created_by_user_id,updated_at) VALUES (?,?,'CSV_REVIEW','prices.csv',?,NOW(3))",
        [batch,org,actor]);
      for(const [number,testCode,amount] of [
        [1,prefix+"TA","100.1250"],[101,prefix+"TB","9999.9999"],[102,prefix+"TF","8000.0000"],
      ] as const){
        const data=JSON.stringify({priceListCode:prefix+"LIST",testCode,unitPrice:amount,
          effectiveFrom:"2026-10-01",effectiveTo:""});
        await exec("INSERT INTO catalog_import_rows(id,batch_id,`row_number`,entity_type,status,source_data,normalized_data,updated_at) VALUES (?,?,?,'PRICE_LIST_ITEM','WARNING',?,?,NOW(3))",
          [randomUUID(),batch,number,data,data]);
      }

      const scope=resolveClinicalImportScope({organizationId:org,activeBranchId:branchA,
        activeBranch:{id:branchA,organizationId:org,status:"ACTIVE"},
        branchScopes:[{branchId:branchA,branch:{status:"ACTIVE"}},{branchId:branchB,branch:{status:"ACTIVE"}}],
        departmentScopes:[{departmentId:dA,department:{status:"ACTIVE",organizationId:org,branchId:branchA}},
          {departmentId:dB,department:{status:"ACTIVE",organizationId:org,branchId:branchB}}]});
      assert.ok(scope);
      assert.deepEqual(clinicalImportTestWhere(scope).departmentId,{in:[dA]});
      const [allowed]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT t.code FROM lab_tests t JOIN departments d ON d.id=t.department_id WHERE t.organization_id=? AND t.status='ACTIVE' AND d.status='ACTIVE' AND (d.branch_id IS NULL OR d.branch_id=?) AND t.department_id IN (?)",
        [org,branchA,dA]);
      const codes=new Set(allowed.map(x=>String(x.code).toUpperCase()));
      assert.deepEqual([...codes],[(prefix+"TA").toUpperCase()]);
      const [rows]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT `row_number` AS `row_number`,normalized_data FROM catalog_import_rows WHERE batch_id=? AND entity_type='PRICE_LIST_ITEM' ORDER BY `row_number`",
        [batch]);
      assert.deepEqual(rows.map(x=>Number(x.row_number)),[1,101,102]);
      const disclosed:number[]=[];
      const redacted:number[]=[];
      for(const row of rows){
        const normalized=typeof row.normalized_data==="string"
          ? JSON.parse(row.normalized_data) : row.normalized_data;
        const code=stagedPriceTestCode(normalized);
        (codes.has(code)?disclosed:redacted).push(Number(row.row_number));
      }
      assert.deepEqual(disclosed,[1]);
      assert.deepEqual(redacted,[101,102]);
      const invalid=resolveClinicalImportScope({organizationId:org,activeBranchId:branchA,
        activeBranch:{id:branchA,organizationId:org,status:"ACTIVE"},
        branchScopes:[{branchId:branchA,branch:{status:"ACTIVE"}}],
        departmentScopes:[{departmentId:dB,department:{status:"ACTIVE",organizationId:org,branchId:branchB}}]});
      assert.equal(invalid,null,"foreign-branch-only department grants must not expand test visibility");
      const [livePrices]=await reader.execute<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM price_list_items WHERE price_list_id=?",[list]);
      assert.equal(Number(livePrices[0].count),0,"no live price activation");
    } finally {
      await exec("DELETE FROM catalog_import_rows WHERE batch_id=?",[batch]).catch(()=>{});
      await exec("DELETE FROM catalog_import_batches WHERE id=?",[batch]).catch(()=>{});
      await exec("DELETE FROM price_lists WHERE id=?",[list]).catch(()=>{});
      await exec("DELETE FROM users WHERE id=?",[actor]).catch(()=>{});
      await exec("DELETE FROM lab_tests WHERE id IN (?,?,?)",[tA,tB,tOther]).catch(()=>{});
      await exec("DELETE FROM departments WHERE id IN (?,?,?)",[dA,dB,dOther]).catch(()=>{});
      await exec("DELETE FROM branches WHERE id IN (?,?)",[branchA,branchB]).catch(()=>{});
      await exec("DELETE FROM organizations WHERE id IN (?,?)",[org,other]).catch(()=>{});
      await Promise.all([writer.end(),reader.end()]);
    }
  });
