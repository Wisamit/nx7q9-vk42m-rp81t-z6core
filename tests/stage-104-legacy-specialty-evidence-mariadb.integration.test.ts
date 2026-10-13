import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import mysql from "mysql2/promise";
import {
  LEGACY_SPECIALTY_EVIDENCE_TYPE,parseSpecialtyEvidence,buildSpecialtyEvidenceReview,
} from "../src/lib/legacy-specialty-evidence.ts";

test("Stage 104 MariaDB: legacy evidence review matches only selected tenant's configured active test components",
  {timeout:60000},async()=>{
  if(!process.env.DATABASE_URL)throw Error("DATABASE_URL required");
  const url=new URL(process.env.DATABASE_URL);
  const config={host:url.hostname,port:Number(url.port||3306),
    user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),database:url.pathname.slice(1)};
  const db=await mysql.createConnection(config);
  const org=randomUUID(),other=randomUUID(),testId=randomUUID(),foreignTestId=randomUUID(),
    ownComponent=randomUUID(),foreignComponent=randomUUID();
  const key=org.slice(0,8);
  const rows:Array<{table:string;id:string}>=[];
  const insert=async(table:string,id:string,sql:string,args:string[])=>{
    await db.execute(sql,args);rows.unshift({table,id});
  };
  try{
    await insert("organizations",org,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [org,"E104A"+key,"Evidence tenant"]);
    await insert("organizations",other,"INSERT INTO organizations(id,code,name_en,updated_at) VALUES(?,?,?,NOW(3))",
      [other,"E104B"+key,"Other tenant"]);
    await insert("lab_tests",testId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [testId,org,"E104T"+key,"Current clinical catalog"]);
    await insert("lab_tests",foreignTestId,
      "INSERT INTO lab_tests(id,organization_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [foreignTestId,other,"E104X"+key,"Other clinical catalog"]);
    await insert("test_components",ownComponent,
      "INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [ownComponent,testId,"TSH","Current configured component"]);
    await insert("test_components",foreignComponent,
      "INSERT INTO test_components(id,test_id,code,name_en,updated_at) VALUES(?,?,?,?,NOW(3))",
      [foreignComponent,foreignTestId,"FT4","Foreign component"]);
    const [current]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT c.id,c.code,c.name_en AS nameEn,c.name_ar AS nameAr FROM test_components c INNER JOIN lab_tests t ON t.id=c.test_id WHERE t.id=? AND t.organization_id=? AND t.status='ACTIVE' AND c.status='ACTIVE'",
      [testId,org]);
    const [foreign]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT c.id FROM test_components c INNER JOIN lab_tests t ON t.id=c.test_id WHERE t.id=? AND t.organization_id=?",
      [foreignTestId,org]);
    assert.equal(current.length,1);
    assert.equal(foreign.length,0);
    const evidence=parseSpecialtyEvidence({
      schemaVersion:1,evidenceType:LEGACY_SPECIALTY_EVIDENCE_TYPE,
      sourceName:"Family lab -test.mdb",sourceSha256:"a".repeat(64),
      exportedAtUtc:"2026-10-13T07:00:00.000Z",clinicalUseApproved:false,
      tables:[{tableName:"Thyroidn",pairingComplete:true,warnings:[],candidatePairs:[
        {sourcePrefix:"TSH",lowColumn:"TSHL",highColumn:"TSHH",observations:[
          {rowNumber:1,low:"1",high:"4",sex:null,ageFrom:null,ageTo:null,ageUnit:null},
        ]},
        {sourcePrefix:"FT4",lowColumn:"FT4L",highColumn:"FT4H",observations:[]},
      ]}],
    });
    const matched=buildSpecialtyEvidenceReview(evidence,current.map(c=>({
      id:c.id,code:c.code,nameEn:c.nameEn,nameAr:c.nameAr,
    })));
    assert.equal(matched.tables[0].pairs[0].matchStatus,"EXACT_COMPONENT_CODE");
    assert.equal(matched.tables[0].pairs[0].matchedComponentId,ownComponent);
    assert.equal(matched.tables[0].pairs[1].matchStatus,"NO_EXACT_CODE_MATCH");
    assert.equal(matched.reviewOnly,true);
    const [untouched]=await db.execute<mysql.RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM reference_intervals WHERE component_id IN (?,?)",
      [ownComponent,foreignComponent]);
    assert.equal(Number(untouched[0].total),0);
  }finally{
    for(const {table,id} of rows)await db.execute("DELETE FROM "+table+" WHERE id=?",[id]).catch(()=>{});
    await db.end();
  }
});
