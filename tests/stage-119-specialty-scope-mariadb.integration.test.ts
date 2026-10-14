import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {
  LEGACY_SPECIALTY_EVIDENCE_TYPE,parseSpecialtyEvidence,buildSelectedSpecialtyEvidenceReview,
} from "../src/lib/legacy-specialty-evidence.ts";

test("Stage 119 MariaDB: real department/branch-scoped specialty evidence excludes foreign components",
  {timeout:90_000},async()=>{
    if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
    const uri=new URL(process.env.DATABASE_URL);
    const cfg={host:uri.hostname,port:Number(uri.port||3306),
      user:decodeURIComponent(uri.username),password:decodeURIComponent(uri.password),
      database:uri.pathname.slice(1)};
    const db=await mysql.createConnection(cfg);
    const org=randomUUID(),foreign=randomUUID(),branchA=randomUUID(),branchB=randomUUID();
    const departmentA=randomUUID(),departmentB=randomUUID(),testA=randomUUID(),testB=randomUUID();
    const componentA=randomUUID(),componentB=randomUUID(),suffix=org.slice(0,8);
    const cleanup:Array<{table:string;id:string}>=[];
    const add=async(table:string,id:string,sql:string,args:(string|null)[])=>{
      await db.execute(sql,args);cleanup.unshift({table,id});
    };
    try{
      for(const [id,code] of [[org,"A"],[foreign,"X"]]){
        await add("organizations",id,
          "INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
          [id,"S119"+suffix+code,"Synthetic Lab"]);
      }
      for(const [id,code] of [[branchA,"A"],[branchB,"B"]]){
        await add("branches",id,
          "INSERT INTO branches(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id,org,"S119"+suffix+code,"Synthetic branch"]);
      }
      for(const [id,code,branch] of [[departmentA,"A",branchA],[departmentB,"B",branchB]]){
        await add("departments",id,
          "INSERT INTO departments(id,organization_id,branch_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
          [id,org,branch,"S119"+suffix+code,"Synthetic department"]);
      }
      for(const [id,code,department] of [[testA,"A",departmentA],[testB,"B",departmentB]]){
        await add("lab_tests",id,
          "INSERT INTO lab_tests(id,organization_id,department_id,code,name_en,updated_at) VALUES(?,?,?,?,?,NOW(3))",
          [id,org,department,"S119"+suffix+code,"Synthetic test"]);
      }
      for(const [id,tid,code]of [[componentA,testA,"TSH"],[componentB,testB,"FT4"]]){
        await add("test_components",id,
          "INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
          [id,tid,code,"Synthetic component"]);
      }
      const sql="SELECT c.id,c.code,c.name_en AS nameEn,c.name_ar AS nameAr "+
        "FROM test_components c JOIN lab_tests t ON t.id=c.test_id "+
        "LEFT JOIN departments d ON d.id=t.department_id "+
        "WHERE t.id=? AND t.organization_id=? AND t.status='ACTIVE' AND c.status='ACTIVE' "+
        "AND (t.department_id IS NULL OR (d.status='ACTIVE' AND "+
        "(d.branch_id IS NULL OR d.branch_id=?))) "+
        "AND (t.department_id IS NULL OR t.department_id IN (?))";
      const [own]=await db.execute<mysql.RowDataPacket[]>(sql,[testA,org,branchA,departmentA]);
      const [offBranch]=await db.execute<mysql.RowDataPacket[]>(sql,[testB,org,branchA,departmentA]);
      const [offDepartment]=await db.execute<mysql.RowDataPacket[]>(sql,[testA,org,branchA,departmentB]);
      const [offTenant]=await db.execute<mysql.RowDataPacket[]>(sql,[testA,foreign,branchA,departmentA]);
      assert.deepEqual(own.map(r=>r.id),[componentA]);
      assert.equal(offBranch.length,0);
      assert.equal(offDepartment.length,0);
      assert.equal(offTenant.length,0);
      const evidence=parseSpecialtyEvidence({
        schemaVersion:1,evidenceType:LEGACY_SPECIALTY_EVIDENCE_TYPE,
        sourceName:"Family lab -test.mdb",sourceSha256:"a".repeat(64),
        exportedAtUtc:"2026-10-14T12:00:00.000Z",clinicalUseApproved:false,
        tables:[{tableName:"Thyroidn",pairingComplete:true,warnings:[],candidatePairs:[
          {sourcePrefix:"TSH",lowColumn:"TSHL",highColumn:"TSHH",
            observations:[{rowNumber:1,low:"0.5",high:"4.5",sex:null,ageFrom:null,
              ageTo:null,ageUnit:null}]},
          {sourcePrefix:"FT4",lowColumn:"FT4L",highColumn:"FT4H",observations:[]},
        ]},{tableName:"cbcn",pairingComplete:true,warnings:[],candidatePairs:[
          {sourcePrefix:"WBC",lowColumn:"WBCL",highColumn:"WBCH",observations:[]},
        ]}],
      });
      const review=buildSelectedSpecialtyEvidenceReview(evidence,own.map(r=>({
        id:r.id,code:r.code,nameEn:r.nameEn,nameAr:r.nameAr,
      })),"Thyroidn");
      assert.equal(review.totalCandidatePairs,2);
      assert.equal(review.exactCodePairCount,1);
      assert.equal(review.excludedOtherSourceTables,1);
      assert.equal(review.tables[0].pairs[1].matchStatus,"NO_EXACT_CODE_MATCH");
      assert.equal(review.clinicalMappingConfirmed,false);
      const [medical]=await db.execute<mysql.RowDataPacket[]>(
        "SELECT COUNT(*) AS count FROM reference_intervals WHERE component_id IN (?,?)",
        [componentA,componentB]);
      assert.equal(Number(medical[0].count),0);
    }finally{
      for(const {table,id}of cleanup)await db.execute(
        "DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
      await db.end();
    }
  });
